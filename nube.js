/* ==================================================================== *
 * nube.js  —  Almacenamiento permanente en Cloudflare R2
 * -------------------------------------------------------------------- *
 * Guarda los PDF, el listado de carpetas y los usuarios FUERA del
 * servidor, de modo que nada se borra cuando Render reinicia el
 * servicio (algo que en el plan gratuito ocurre a diario).
 *
 * Solo usa modulos nativos de Node.js (https + crypto): no hay que
 * instalar librerias. Habla el protocolo S3 con firma AWS v4, que es
 * el que entiende Cloudflare R2 (y tambien Backblaze B2, MinIO, AWS S3
 * o Wasabi si algun dia se quiere cambiar de proveedor).
 *
 * Variables de entorno necesarias:
 *   R2_ENDPOINT           https://<ID_DE_CUENTA>.r2.cloudflarestorage.com
 *                         (o R2_ACCOUNT_ID=<ID_DE_CUENTA> y se arma solo)
 *   R2_BUCKET             nombre del bucket, p. ej. gestion-documental
 *   R2_ACCESS_KEY_ID      Access Key ID del token de R2
 *   R2_SECRET_ACCESS_KEY  Secret Access Key del token de R2
 *   R2_PREFIX             (opcional) subcarpeta dentro del bucket
 *   R2_REGION             (opcional) por defecto "auto"
 * ==================================================================== */
"use strict";

var https  = require("https");
var http   = require("http");
var crypto = require("crypto");
var { URL } = require("url");

var ENDPOINT = (process.env.R2_ENDPOINT || "").trim();
if(!ENDPOINT && process.env.R2_ACCOUNT_ID){
  ENDPOINT = "https://" + String(process.env.R2_ACCOUNT_ID).trim() + ".r2.cloudflarestorage.com";
}
var BUCKET = (process.env.R2_BUCKET || "").trim();
var LLAVE   = (process.env.R2_ACCESS_KEY_ID || "").trim();
var SECRETO = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
var REGION  = (process.env.R2_REGION || "auto").trim();
var PREFIJO = (process.env.R2_PREFIX || "").replace(/^\/+|\/+$/g, "");

var CONFIGURADA = !!(ENDPOINT && BUCKET && LLAVE && SECRETO);
var VACIO_SHA = crypto.createHash("sha256").update("").digest("hex");
var TIEMPO_MS = 30000;      // tiempo maximo de espera por peticion
var INTENTOS  = 3;          // reintentos ante fallos de red o 5xx

function activa(){ return CONFIGURADA; }

/* Describe donde se guardan los datos, en palabras sencillas. */
function describe(){
  if(!CONFIGURADA){
    return { activa:false, permanente:false, tipo:"disco",
             detalle:"el disco del propio servidor (puede borrarse al reiniciar)" };
  }
  var h = "";
  try { h = new URL(ENDPOINT).host; } catch(e){ h = ENDPOINT; }
  return { activa:true, permanente:true, tipo:"r2", deposito:BUCKET, prefijo:PREFIJO || "",
           detalle:"almacenamiento permanente en la nube (" + BUCKET + (PREFIJO ? "/" + PREFIJO : "") + " en " + h + ")" };
}

/* ---------------- utilidades de firma AWS v4 ---------------- */

/* Codificacion estricta RFC 3986 (encodeURIComponent deja pasar !'()* ). */
function uriEnc(s){
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, function(c){
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}
function rutaEnc(clave){
  return String(clave).split("/").map(uriEnc).join("/");
}
function sha256(buf){
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function hmac(clave, dato){
  return crypto.createHmac("sha256", clave).update(dato, "utf8").digest();
}
function claveFirma(fecha){
  var k1 = hmac("AWS4" + SECRETO, fecha);
  var k2 = hmac(k1, REGION);
  var k3 = hmac(k2, "s3");
  return hmac(k3, "aws4_request");
}
function sellos(){
  var t = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amz: t, dia: t.slice(0, 8) };
}

/* Devuelve la clave completa dentro del bucket, con el prefijo opcional. */
function clavePlena(clave){
  var c = String(clave).replace(/^\/+/, "");
  return PREFIJO ? PREFIJO + "/" + c : c;
}

/* ---------------- peticion firmada ---------------- */
function peticion(metodo, clave, cuerpo, opciones){
  opciones = opciones || {};
  if(!CONFIGURADA) return Promise.reject(new Error("El almacenamiento en la nube no esta configurado."));

  var url  = new URL(ENDPOINT);
  var base = "/" + uriEnc(BUCKET) + (clave ? "/" + rutaEnc(clavePlena(clave)) : "");
  var qs   = opciones.query || {};
  var canonQ = Object.keys(qs).sort().map(function(k){
    return uriEnc(k) + "=" + uriEnc(qs[k]);
  }).join("&");

  var datos = cuerpo == null ? Buffer.alloc(0)
            : (Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(String(cuerpo)));
  var hash  = datos.length ? sha256(datos) : VACIO_SHA;
  var s = sellos();

  var cab = {
    "host": url.host,
    "x-amz-content-sha256": hash,
    "x-amz-date": s.amz
  };
  if(opciones.tipo) cab["content-type"] = opciones.tipo;
  if(datos.length)  cab["content-length"] = String(datos.length);

  var nombres = Object.keys(cab).sort();
  var canonCab = nombres.map(function(n){ return n + ":" + String(cab[n]).trim() + "\n"; }).join("");
  var firmados = nombres.join(";");

  var canonica = [metodo, base, canonQ, canonCab, firmados, hash].join("\n");
  var ambito   = s.dia + "/" + REGION + "/s3/aws4_request";
  var porFirmar = ["AWS4-HMAC-SHA256", s.amz, ambito, sha256(canonica)].join("\n");
  var firma = crypto.createHmac("sha256", claveFirma(s.dia)).update(porFirmar, "utf8").digest("hex");

  cab["authorization"] = "AWS4-HMAC-SHA256 Credential=" + LLAVE + "/" + ambito +
                         ", SignedHeaders=" + firmados + ", Signature=" + firma;

  var lib = url.protocol === "http:" ? http : https;
  var conf = {
    method: metodo,
    host: url.hostname,
    port: url.port || (url.protocol === "http:" ? 80 : 443),
    path: base + (canonQ ? "?" + canonQ : ""),
    headers: cab
  };

  return new Promise(function(ok, mal){
    var pet = lib.request(conf, function(res){
      var trozos = [];
      res.on("data", function(c){ trozos.push(c); });
      res.on("end", function(){
        ok({ code: res.statusCode, headers: res.headers, body: Buffer.concat(trozos) });
      });
    });
    pet.setTimeout(TIEMPO_MS, function(){ pet.destroy(new Error("Tiempo de espera agotado con el almacenamiento en la nube.")); });
    pet.on("error", mal);
    if(datos.length) pet.write(datos);
    pet.end();
  });
}

/* Reintenta ante fallos de red o errores temporales del servidor (5xx). */
async function conReintento(metodo, clave, cuerpo, opciones){
  var ultimo;
  for(var i = 1; i <= INTENTOS; i++){
    try {
      var r = await peticion(metodo, clave, cuerpo, opciones);
      if(r.code < 500 || i === INTENTOS) return r;
      ultimo = new Error("El almacenamiento respondio " + r.code);
    } catch(e){
      ultimo = e;
      if(i === INTENTOS) throw e;
    }
    await new Promise(function(ok){ setTimeout(ok, 350 * i); });
  }
  throw ultimo;
}

function textoError(r){
  var t = r.body ? r.body.toString("utf8") : "";
  var m = t.match(/<Message>([^<]*)<\/Message>/);
  return (m ? m[1] : t.slice(0, 200)) || ("error " + r.code);
}

/* ---------------- operaciones publicas ---------------- */

/* Guarda (o reemplaza) un archivo. */
async function guardar(clave, datos, tipo){
  var r = await conReintento("PUT", clave, datos, { tipo: tipo || "application/octet-stream" });
  if(r.code !== 200 && r.code !== 201) throw new Error("No se pudo guardar en la nube: " + textoError(r));
  return true;
}

/* Lee un archivo. Devuelve null si no existe. */
async function leer(clave){
  var r = await conReintento("GET", clave, null, {});
  if(r.code === 404) return null;
  if(r.code !== 200) throw new Error("No se pudo leer de la nube: " + textoError(r));
  return r.body;
}

/* ¿Existe el archivo? Devuelve el tamaño en bytes o -1 si no está. */
async function tamano(clave){
  var r = await conReintento("HEAD", clave, null, {});
  if(r.code === 404) return -1;
  if(r.code !== 200) throw new Error("No se pudo consultar la nube: " + textoError(r));
  return parseInt(r.headers["content-length"] || "0", 10);
}

/* Borra un archivo (no falla si ya no existe). */
async function borrar(clave){
  var r = await conReintento("DELETE", clave, null, {});
  if(r.code !== 204 && r.code !== 200 && r.code !== 404){
    throw new Error("No se pudo borrar en la nube: " + textoError(r));
  }
  return true;
}

/* Lista claves con un prefijo. Devuelve [{clave, bytes, fecha}] */
async function listar(prefijo){
  var salida = [], token = null;
  do {
    var q = { "list-type": "2", "max-keys": "1000" };
    var pre = clavePlena(prefijo || "");
    if(pre) q.prefix = pre;
    if(token) q["continuation-token"] = token;
    var r = await conReintento("GET", "", null, { query: q });
    if(r.code !== 200) throw new Error("No se pudo listar la nube: " + textoError(r));
    var xml = r.body.toString("utf8");
    var re = /<Contents>([\s\S]*?)<\/Contents>/g, m;
    while((m = re.exec(xml))){
      var b = m[1];
      var k  = (b.match(/<Key>([\s\S]*?)<\/Key>/) || [])[1] || "";
      var sz = (b.match(/<Size>(\d+)<\/Size>/) || [])[1] || "0";
      var fe = (b.match(/<LastModified>([^<]*)<\/LastModified>/) || [])[1] || "";
      if(k){
        var corta = PREFIJO && k.indexOf(PREFIJO + "/") === 0 ? k.slice(PREFIJO.length + 1) : k;
        salida.push({ clave: corta, bytes: parseInt(sz, 10), fecha: fe });
      }
    }
    var trunc = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    token = trunc ? ((xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1] || null) : null;
    if(token) token = token.replace(/&amp;/g, "&");
  } while(token);
  return salida;
}

/* Espacio total ocupado (bytes) y numero de archivos. */
async function uso(){
  var l = await listar("");
  var total = l.reduce(function(a, x){ return a + x.bytes; }, 0);
  return { archivos: l.length, bytes: total };
}

/* Comprueba credenciales al arrancar: intenta listar el bucket. */
async function comprobar(){
  if(!CONFIGURADA) return { ok:false, error:"sin configurar" };
  try {
    var r = await peticion("GET", "", null, { query:{ "list-type":"2", "max-keys":"1" } });
    if(r.code === 200) return { ok:true };
    if(r.code === 403) return { ok:false, error:"credenciales rechazadas (revisa Access Key y Secret)" };
    if(r.code === 404) return { ok:false, error:'el bucket "' + BUCKET + '" no existe' };
    return { ok:false, error: textoError(r) };
  } catch(e){
    return { ok:false, error: e.message };
  }
}

module.exports = {
  activa: activa, describe: describe, comprobar: comprobar,
  guardar: guardar, leer: leer, borrar: borrar, tamano: tamano,
  listar: listar, uso: uso
};
