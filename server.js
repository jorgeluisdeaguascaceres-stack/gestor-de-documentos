#!/usr/bin/env node
/* Servidor central opcional para el Sistema de Gestión Documental.
 * Solo usa módulos nativos de Node.js: no requiere instalar librerías.
 *
 *   node server.js                      -> http://localhost:8080
 *   El primer administrador se crea desde la propia pantalla de la app.
 *   (Opcional) APP_USER=admin APP_PASSWORD=ClaveFuerte1 node server.js
 *
 * Administración de usuarios desde la consola:
 *   node server.js usuarios                        -> lista los usuarios
 *   node server.js nuevo-usuario juan Clave1234 auditor
 *   node server.js clave juan NuevaClave1234       -> restablece la clave
 *   node server.js activar juan / node server.js desactivar juan
 *   node server.js borrar-usuario juan
 *
 * Variables: PORT, DATA_DIR, APP_USER, APP_PASSWORD, SESION_HORAS
 *
 * DATOS PERMANENTES (importante en planes gratuitos tipo Render):
 *   si se configuran las variables R2_* (ver nube.js), los PDF, las carpetas,
 *   los usuarios y la bitácora se guardan en Cloudflare R2 y NO se pierden
 *   cuando el servicio se reinicia. Sin esas variables, todo se guarda en el
 *   disco del propio servidor, igual que antes.
 */
"use strict";

var http = require("http");
var fs   = require("fs");
var path = require("path");
var crypto = require("crypto");
var nube = require("./nube");

var PORT     = parseInt(process.env.PORT || "8080", 10);
var DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
var WEB_DIR  = __dirname;
var USER     = process.env.APP_USER || "admin";
var PASS     = process.env.APP_PASSWORD || "";
var SES_MS   = Math.max(1, parseFloat(process.env.SESION_HORAS || "8")) * 3600 * 1000;
var MAX_PDF  = 60 * 1024 * 1024;

/* Detrás de un proxy (Render, Railway, Fly, Nginx) la IP real y el protocolo
 * llegan en cabeceras. Se activa solo, o a mano con TRAS_PROXY=1 / =0. */
var TRAS_PROXY = process.env.TRAS_PROXY
  ? process.env.TRAS_PROXY !== "0"
  : !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME);

var SIGLAS = ["CRC","AUT","HEV","FEV","OPF","EPI"];

/* ================================================================== *
 * ALMACÉN: la nube si está configurada, o el disco local si no
 * ------------------------------------------------------------------ *
 * Todo lo que hay que conservar (db.json, usuarios.json, la bitácora
 * y los PDF) pasa por estas seis funciones. Así el resto del programa
 * no necesita saber dónde acaba guardado cada archivo.
 * ================================================================== */
var EN_NUBE = nube.activa();
if(!EN_NUBE) fs.mkdirSync(DATA_DIR, { recursive:true });

function rutaLocal(clave){
  var abs = path.resolve(DATA_DIR, String(clave).replace(/^\/+/, ""));
  if(abs !== DATA_DIR && abs.indexOf(DATA_DIR + path.sep) !== 0) throw new Error("Ruta no permitida");
  return abs;
}

var almacen = {
  /* Lee un archivo completo. Devuelve null si no existe. */
  leer: async function(clave){
    if(EN_NUBE) return await nube.leer(clave);
    var f = rutaLocal(clave);
    if(!fs.existsSync(f)) return null;
    return fs.readFileSync(f);
  },
  /* Escribe (o reemplaza) un archivo completo. */
  escribir: async function(clave, datos, tipo){
    var buf = Buffer.isBuffer(datos) ? datos : Buffer.from(String(datos), "utf8");
    if(EN_NUBE) return await nube.guardar(clave, buf, tipo);
    var f = rutaLocal(clave);
    fs.mkdirSync(path.dirname(f), { recursive:true });
    var tmp = f + ".tmp";
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, f);
    return true;
  },
  /* Borra un archivo; no protesta si ya no está. */
  borrar: async function(clave){
    if(EN_NUBE) return await nube.borrar(clave);
    try { fs.unlinkSync(rutaLocal(clave)); } catch(e){}
    return true;
  },
  /* ¿Existe? */
  existe: async function(clave){
    if(EN_NUBE) return (await nube.tamano(clave)) >= 0;
    return fs.existsSync(rutaLocal(clave));
  },
  /* Lista claves con ese prefijo: [{clave, bytes}] */
  listar: async function(prefijo){
    if(EN_NUBE) return await nube.listar(prefijo);
    var raiz = rutaLocal(prefijo || ""), salida = [];
    (function rec(dir){
      var l = [];
      try { l = fs.readdirSync(dir, { withFileTypes:true }); } catch(e){ return; }
      l.forEach(function(e){
        var abs = path.join(dir, e.name);
        if(e.isDirectory()) return rec(abs);
        if(/\.tmp$/.test(e.name)) return;
        var rel = path.relative(DATA_DIR, abs).split(path.sep).join("/");
        salida.push({ clave: rel, bytes: fs.statSync(abs).size });
      });
    })(raiz);
    return salida;
  }
};

/* ---------------- base de datos (db.json) ---------------- */
var CLAVE_DB  = "datos/db.json";
var CLAVE_USU = "datos/usuarios.json";
var CLAVE_LOG = "datos/bitacora.log";
var PRE_DOCS  = "documentos/";

var db = { lotes:[] };

/* Escritor con cola: si llegan varios cambios seguidos, se guarda una vez
 * al final. Evita mandar veinte peticiones a la nube por un mismo clic. */
function escritorEnCola(nombreClave, obtenerDatos){
  var guardando = false, pendiente = false;
  return function guarda(){
    if(guardando){ pendiente = true; return; }
    guardando = true;
    almacen.escribir(nombreClave, JSON.stringify(obtenerDatos(), null, 2), "application/json")
      .catch(function(e){ console.error("✖ No se pudo guardar " + nombreClave + ": " + e.message); })
      .then(function(){
        guardando = false;
        if(pendiente){ pendiente = false; guarda(); }
      });
  };
}
var save = escritorEnCola(CLAVE_DB, function(){ return db; });

/* ---------------- saneamiento de rutas ---------------- */
function limpiaNombre(s){
  return String(s == null ? "" : s).replace(/[\\/:*?"<>|\u0000-\u001f]/g,"").replace(/\.+$/,"").trim();
}
function limpiaRuta(s){
  // La ruta que escribe el usuario se guarda solo como referencia visible
  // (por ejemplo C:\Users\JORGE\Documents\PROYECT). No se inventan niveles.
  var r = String(s == null ? "" : s).replace(/[*?"<>|\u0000-\u001f]/g, "").trim();
  r = r.replace(/\/{2,}/g, "/").replace(/\\{2,}/g, "\\");
  return r.replace(/[\/\\]+$/, "");
}
/* Cada lote es una carpeta con su nombre dentro del almacén (nube o disco).
 * Se devuelve la "clave" del documento, que es simplemente su ruta relativa. */
function claveDoc(lote, nombre){
  var carpeta = limpiaNombre(lote.carpeta);
  if(!carpeta) throw new Error("Carpeta no válida");
  var arch = limpiaNombre(nombre);
  if(!arch) throw new Error("Nombre de archivo no válido");
  return PRE_DOCS + carpeta + "/" + arch;
}
function nombreArchivo(sigla, nit, carpeta, sep){
  return limpiaNombre(sigla.toUpperCase() + sep + nit + sep + carpeta) + ".pdf";
}

/* ---------------- ZIP (método store) ---------------- */
var CRC_T = (function(){
  var t = new Uint32Array(256);
  for(var n=0;n<256;n++){ var c=n; for(var k=0;k<8;k++) c = (c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; }
  return t;
})();
function crc32(buf){
  var c = 0xFFFFFFFF;
  for(var i=0;i<buf.length;i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c>>>8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function W(v,off,val,bytes){ for(var i=0;i<bytes;i++) v[off+i] = (val >>> (8*i)) & 0xFF; }
function dosT(d){
  var y = d.getFullYear();
  if(y < 1980) return { t:0, d:0x21 };
  return { t:((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()/2|0))&0xFFFF,
           d:(((y-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())&0xFFFF };
}
function zipBuffer(items){    // [{path, data:Buffer}]
  var parts = [], central = [], offset = 0, now = dosT(new Date());
  items.forEach(function(it){
    var nb = Buffer.from(it.path,"utf8"), crc = crc32(it.data), size = it.data.length;
    var lh = Buffer.alloc(30 + nb.length);
    W(lh,0,0x04034b50,4); W(lh,4,20,2); W(lh,6,0x0800,2); W(lh,8,0,2);
    W(lh,10,now.t,2); W(lh,12,now.d,2); W(lh,14,crc,4);
    W(lh,18,size,4); W(lh,22,size,4); W(lh,26,nb.length,2); W(lh,28,0,2);
    nb.copy(lh,30);
    parts.push(lh, it.data);
    var ch = Buffer.alloc(46 + nb.length);
    W(ch,0,0x02014b50,4); W(ch,4,20,2); W(ch,6,20,2); W(ch,8,0x0800,2); W(ch,10,0,2);
    W(ch,12,now.t,2); W(ch,14,now.d,2); W(ch,16,crc,4);
    W(ch,20,size,4); W(ch,24,size,4); W(ch,28,nb.length,2);
    W(ch,30,0,2); W(ch,32,0,2); W(ch,34,0,2); W(ch,36,0,2); W(ch,38,0,4); W(ch,42,offset,4);
    nb.copy(ch,46);
    central.push(ch);
    offset += lh.length + size;
  });
  var cd = central.reduce(function(a,b){ return a + b.length; }, 0);
  var end = Buffer.alloc(22);
  W(end,0,0x06054b50,4); W(end,4,0,2); W(end,6,0,2);
  W(end,8,central.length,2); W(end,10,central.length,2);
  W(end,12,cd,4); W(end,16,offset,4); W(end,20,0,2);
  return Buffer.concat(parts.concat(central,[end]));
}

/* ---------------- helpers HTTP ---------------- */
function json(res, code, obj){
  var b = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, {
    "Content-Type":"application/json; charset=utf-8",
    "Content-Length":b.length,
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff"
  });
  res.end(b);
}
function eq(a,b){
  var x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if(x.length !== y.length) return false;
  return crypto.timingSafeEqual(x,y);
}
/* ================================================================== *
 * SEGURIDAD: usuarios, contraseñas y sesiones
 * ------------------------------------------------------------------ *
 * Las contraseñas NUNCA se guardan en texto plano: se guarda un
 * resumen PBKDF2-SHA512 con sal aleatoria distinta por usuario.
 * ================================================================== */
var ITER = 150000, KEYLEN = 32, DIGEST = "sha512";

var usuarios = { usuarios: [] };
var guardaUsuarios = escritorEnCola(CLAVE_USU, function(){ return usuarios; });
/* Versión que espera a que el guardado termine (comandos de consola). */
function guardaUsuariosYa(){
  return almacen.escribir(CLAVE_USU, JSON.stringify(usuarios,null,2), "application/json");
}

/* Carga db.json y usuarios.json del almacén antes de abrir el servidor. */
async function cargarDatos(){
  try {
    var b = await almacen.leer(CLAVE_DB);
    if(b) db = JSON.parse(b.toString("utf8"));
  } catch(e){ console.error("No se pudo leer el listado de carpetas: " + e.message); }
  if(!db || !Array.isArray(db.lotes)) db = { lotes: [] };
  try {
    var c = await almacen.leer(CLAVE_USU);
    if(c) usuarios = JSON.parse(c.toString("utf8"));
  } catch(e){ console.error("No se pudo leer la lista de usuarios: " + e.message); }
  if(!usuarios || !Array.isArray(usuarios.usuarios)) usuarios = { usuarios: [] };
}
function normUsuario(s){
  return String(s == null ? "" : s).trim().toLowerCase().replace(/[^a-z0-9._-]/g,"");
}
function buscaUsuario(nombre){
  var n = normUsuario(nombre);
  return usuarios.usuarios.filter(function(u){ return u.usuario === n; })[0] || null;
}
function resumen(clave, salt, iter){
  return crypto.pbkdf2Sync(String(clave), Buffer.from(salt,"hex"), iter || ITER, KEYLEN, DIGEST).toString("hex");
}
function claveDebil(clave){
  var c = String(clave == null ? "" : clave);
  if(c.length < 8) return "La contrase\u00f1a debe tener al menos 8 caracteres.";
  if(!/[A-Za-z]/.test(c) || !/[0-9]/.test(c)) return "La contrase\u00f1a debe combinar letras y n\u00fameros.";
  if(/^(12345678|contrasena|password|admin123|qwerty123)$/i.test(c)) return "Esa contrase\u00f1a es demasiado com\u00fan.";
  return "";
}
function creaUsuario(nombre, clave, rol, forzar){
  var n = normUsuario(nombre);
  if(n.length < 3) return { error:"El usuario debe tener al menos 3 caracteres (letras, n\u00fameros, punto o guion)." };
  if(buscaUsuario(n)) return { error:'El usuario "'+n+'" ya existe.' };
  if(!forzar){
    var mal = claveDebil(clave);
    if(mal) return { error: mal };
  }
  var salt = crypto.randomBytes(16).toString("hex");
  var u = {
    usuario: n,
    rol: rol === "admin" ? "admin" : "auditor",
    salt: salt, iter: ITER, digest: DIGEST,
    hash: resumen(clave, salt, ITER),
    activo: true, creado: Date.now(), ultimo: 0
  };
  usuarios.usuarios.push(u);
  guardaUsuarios();
  return { usuario: u };
}
function cambiaClave(nombre, clave){
  var u = buscaUsuario(nombre);
  if(!u) return { error:"Ese usuario no existe." };
  var mal = claveDebil(clave);
  if(mal) return { error: mal };
  u.salt = crypto.randomBytes(16).toString("hex");
  u.iter = ITER; u.digest = DIGEST;
  u.hash = resumen(clave, u.salt, ITER);
  guardaUsuarios();
  cierraSesionesDe(u.usuario);
  return { usuario: u };
}
function verifica(nombre, clave){
  var u = buscaUsuario(nombre);
  if(!u || !u.activo) return null;
  var calc;
  try { calc = resumen(clave, u.salt, u.iter); } catch(e){ return null; }
  return eq(calc, u.hash) ? u : null;
}
function hayUsuarios(){
  return usuarios.usuarios.some(function(u){ return u.activo; });
}

/* ---------------- bitácora de accesos ---------------- */
/* Se acumula en memoria y se vuelca cada pocos segundos, para no escribir
 * en la nube una vez por línea. También se vuelca al apagar el servicio. */
var logBuffer = "", logCargado = false, logGuardando = false;
function bitacora(texto){
  logBuffer += new Date().toISOString() + "  " + texto + "\n";
}
async function vuelcaBitacora(){
  if(logGuardando || !logBuffer) return;
  logGuardando = true;
  var trozo = logBuffer; logBuffer = "";
  try {
    var previo = null;
    try { previo = await almacen.leer(CLAVE_LOG); } catch(e){}
    var texto = (previo ? previo.toString("utf8") : "") + trozo;
    /* La bitácora se recorta a las últimas 5.000 líneas: información
       suficiente para auditoría sin engordar el almacenamiento. */
    var lineas = texto.split("\n");
    if(lineas.length > 5000) texto = lineas.slice(lineas.length - 5000).join("\n");
    await almacen.escribir(CLAVE_LOG, texto, "text/plain; charset=utf-8");
    logCargado = true;
  } catch(e){
    logBuffer = trozo + logBuffer;    // se reintenta en el siguiente turno
  }
  logGuardando = false;
}
setInterval(function(){ vuelcaBitacora(); }, 15000).unref();
["SIGINT","SIGTERM"].forEach(function(s){
  process.on(s, function(){
    vuelcaBitacora().then(function(){ process.exit(0); }, function(){ process.exit(0); });
    setTimeout(function(){ process.exit(0); }, 4000);
  });
});

/* ---------------- intentos fallidos y bloqueo temporal ---------------- */
var MAX_INTENTOS = 5, BLOQUEO_MS = 5 * 60 * 1000;
var intentos = Object.create(null);
function ipDe(req){
  if(TRAS_PROXY){
    var f = req.headers["x-forwarded-for"];
    if(f) return String(f).split(",")[0].trim().replace(/^::ffff:/,"");
  }
  var ip = (req.socket && req.socket.remoteAddress) || "?";
  return String(ip).replace(/^::ffff:/,"");
}
function esHttps(req){
  if(req.socket && req.socket.encrypted) return true;
  if(TRAS_PROXY && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https") return true;
  return false;
}
function claveIntento(req, nombre){ return normUsuario(nombre) + "|" + ipDe(req); }
function bloqueado(k){
  var e = intentos[k];
  if(!e || !e.hasta) return 0;
  if(e.hasta > Date.now()) return Math.ceil((e.hasta - Date.now())/1000);
  delete intentos[k];
  return 0;
}
function fallo(k){
  var e = intentos[k] || (intentos[k] = { n:0, hasta:0 });
  e.n++;
  if(e.n >= MAX_INTENTOS){ e.hasta = Date.now() + BLOQUEO_MS; e.n = 0; }
  return MAX_INTENTOS - e.n;
}
function exito(k){ delete intentos[k]; }

/* ---------------- sesiones (en memoria del servidor) ---------------- */
var sesiones = Object.create(null);
function nuevaSesion(u, req){
  var token = crypto.randomBytes(32).toString("hex");
  sesiones[token] = { usuario:u.usuario, rol:u.rol, exp: Date.now() + SES_MS, ip: ipDe(req) };
  return token;
}
function sesionDe(req){
  var m = /(?:^|;\s*)sesion=([a-f0-9]{64})/.exec(req.headers.cookie || "");
  if(!m) return null;
  var s = sesiones[m[1]];
  if(!s) return null;
  if(s.exp <= Date.now()){ delete sesiones[m[1]]; return null; }
  s.exp = Date.now() + SES_MS;          // se renueva mientras haya actividad
  s.token = m[1];
  return s;
}
function cierraSesionesDe(nombre){
  Object.keys(sesiones).forEach(function(t){
    if(sesiones[t].usuario === nombre) delete sesiones[t];
  });
}
setInterval(function(){
  var ahora = Date.now();
  Object.keys(sesiones).forEach(function(t){ if(sesiones[t].exp <= ahora) delete sesiones[t]; });
}, 10 * 60 * 1000).unref();
function cookieSesion(token, borrar, req){
  /* Secure solo con HTTPS: en local (http://localhost) el navegador la rechazaría. */
  var seguro = req ? esHttps(req) : TRAS_PROXY;
  return "sesion=" + (borrar ? "" : token) + "; Path=/; HttpOnly; SameSite=Strict" +
         (seguro ? "; Secure" : "") +
         (borrar ? "; Max-Age=0" : "; Max-Age=" + Math.floor(SES_MS/1000));
}

/* ---------------- autorización de cada petición ---------------- */
function autorizado(req,res){
  if(!hayUsuarios()){
    /* Sin usuarios no se abre nada: la propia pantalla ofrece crear el primer
       administrador (endpoint /api/primer-admin). Nunca hay modo abierto. */
    json(res, 401, { instalar:true,
      error:"La aplicaci\u00f3n todav\u00eda no tiene usuarios. Crea el primer administrador en la pantalla de acceso." });
    return false;
  }
  var s = sesionDe(req);
  if(s){ req.sesion = s; return true; }
  var h = req.headers.authorization || "";
  if(h.indexOf("Basic ") === 0){        // compatibilidad con scripts
    var dec = Buffer.from(h.slice(6), "base64").toString("utf8");
    var i = dec.indexOf(":");
    if(i > 0){
      var us = verifica(dec.slice(0,i), dec.slice(i+1));
      if(us){ req.sesion = { usuario:us.usuario, rol:us.rol }; return true; }
    }
  }
  json(res, 401, { error:"Debes iniciar sesi\u00f3n para continuar.", login:true });
  return false;
}
function soloAdmin(req,res){
  if(req.sesion && req.sesion.rol === "admin") return true;
  json(res, 403, { error:"Solo un administrador puede hacer esto." });
  return false;
}
function leerCuerpo(req, limite){
  return new Promise(function(res, rej){
    var chunks = [], total = 0;
    req.on("data", function(c){
      total += c.length;
      if(total > limite){ rej(new Error("Archivo demasiado grande")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", function(){ res(Buffer.concat(chunks)); });
    req.on("error", rej);
  });
}
function pub(l){
  return { id:l.id, ruta:l.ruta, carpeta:l.carpeta, nit:l.nit, sep:l.sep, creado:l.creado, docs:l.docs || {} };
}

/* ---------------- archivos estáticos ---------------- */
var MIME = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8",
             ".css":"text/css; charset=utf-8", ".ico":"image/x-icon", ".md":"text/markdown; charset=utf-8" };
function estatico(req,res,url){
  var rel = url === "/" ? "index.html" : url.replace(/^\/+/,"");
  var abs = path.resolve(WEB_DIR, rel);
  if(abs.indexOf(WEB_DIR + path.sep) !== 0 || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()){
    res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"}); res.end("No encontrado"); return;
  }
  if([".html",".js",".css",".ico",".md"].indexOf(path.extname(abs)) < 0){
    res.writeHead(403, {"Content-Type":"text/plain; charset=utf-8"}); res.end("Prohibido"); return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(abs)] || "application/octet-stream",
    "Cache-Control":"no-cache",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer",
    "X-Frame-Options":"SAMEORIGIN"
  });
  fs.createReadStream(abs).pipe(res);
}

/* ================================================================== *
 * Administración de usuarios desde la consola
 *   node server.js usuarios
 *   node server.js nuevo-usuario juan Clave1234 auditor
 *   node server.js clave juan NuevaClave1234
 *   node server.js activar|desactivar juan
 *   node server.js borrar-usuario juan
 * ================================================================== */
var cmd = (process.argv[2] || "").toLowerCase();
async function comandosConsola(){
  var a1 = process.argv[3], a2 = process.argv[4], a3 = process.argv[5];
  var fin = async function(code){ try { await guardaUsuariosYa(); } catch(e){} process.exit(code); };
  var pad = function(s,n){ s = String(s); return s + new Array(Math.max(2, n - s.length + 1)).join(" "); };
  if(cmd === "usuarios" || cmd === "lista"){
    if(!usuarios.usuarios.length) console.log("No hay usuarios creados.");
    else {
      console.log(pad("USUARIO",18) + pad("ROL",10) + pad("ESTADO",10) + "\u00daLTIMO ACCESO");
      usuarios.usuarios.forEach(function(x){
        console.log(pad(x.usuario,18) + pad(x.rol,10) + pad(x.activo ? "activo" : "inactivo",10) +
                    (x.ultimo ? new Date(x.ultimo).toLocaleString() : "nunca"));
      });
    }
    return fin(0);
  }
  if(cmd === "nuevo-usuario"){
    if(!a1 || !a2){ console.log("Uso: node server.js nuevo-usuario <usuario> <clave> [admin|auditor]"); return fin(1); }
    var r1 = creaUsuario(a1, a2, a3 || "auditor", false);
    console.log(r1.error ? "\u2716 " + r1.error : '\u2714 Usuario "' + r1.usuario.usuario + '" creado (' + r1.usuario.rol + ").");
    return fin(r1.error ? 1 : 0);
  }
  if(cmd === "clave"){
    if(!a1 || !a2){ console.log("Uso: node server.js clave <usuario> <nueva-clave>"); return fin(1); }
    var r2 = cambiaClave(a1, a2);
    console.log(r2.error ? "\u2716 " + r2.error : "\u2714 Contrase\u00f1a actualizada para " + normUsuario(a1) + ".");
    return fin(r2.error ? 1 : 0);
  }
  if(cmd === "activar" || cmd === "desactivar"){
    var u4 = buscaUsuario(a1);
    if(!u4){ console.log("\u2716 Ese usuario no existe."); return fin(1); }
    u4.activo = (cmd === "activar");
    if(!u4.activo) cierraSesionesDe(u4.usuario);
    console.log("\u2714 " + u4.usuario + " ahora est\u00e1 " + (u4.activo ? "activo" : "inactivo") + ".");
    return fin(0);
  }
  if(cmd === "borrar-usuario"){
    var n5 = normUsuario(a1), antes = usuarios.usuarios.length;
    usuarios.usuarios = usuarios.usuarios.filter(function(x){ return x.usuario !== n5; });
    if(usuarios.usuarios.length === antes){ console.log("\u2716 Ese usuario no existe."); return fin(1); }
    cierraSesionesDe(n5);
    console.log("\u2714 Usuario " + n5 + " eliminado.");
    return fin(0);
  }
  console.log("Comandos disponibles: usuarios | nuevo-usuario | clave | activar | desactivar | borrar-usuario");
  return fin(1);
}

/* ---------------- servidor ---------------- */
var servidor = http.createServer(async function(req,res){
  var u = new URL(req.url, "http://x");
  var p = decodeURIComponent(u.pathname);

  if(p === "/api/health"){
    var s0 = sesionDe(req);
    return json(res, 200, {
      ok:true,
      auth: hayUsuarios(),
      instalar: !hayUsuarios(),
      nube: nube.describe(),
      sesion: s0 ? { usuario:s0.usuario, rol:s0.rol } : null
    });
  }

  /* ---- alta del PRIMER administrador (solo si todavía no hay usuarios) ----
     Es la única forma de estrenar la aplicación sin tocar la consola: en cuanto
     existe un usuario, esta puerta se cierra para siempre. */
  if(p === "/api/primer-admin" && req.method === "POST"){
    if(hayUsuarios()) return json(res,403,{ error:"Ya hay usuarios creados. Pide al administrador que te dé acceso." });
    var dp;
    try { dp = JSON.parse((await leerCuerpo(req, 4096)).toString("utf8") || "{}"); }
    catch(e){ return json(res,400,{ error:"Datos no v\u00e1lidos" }); }
    var rp = creaUsuario(dp.usuario, dp.clave, "admin", false);
    if(rp.error) return json(res,400,{ error: rp.error });
    rp.usuario.ultimo = Date.now(); guardaUsuarios();
    var tokp = nuevaSesion(rp.usuario, req);
    bitacora("1er ADMIN  " + rp.usuario.usuario + "  " + ipDe(req));
    res.setHeader("Set-Cookie", cookieSesion(tokp, false, req));
    return json(res,200,{ ok:true, usuario: rp.usuario.usuario, rol:"admin" });
  }

  /* ---- inicio de sesión ---- */
  if(p === "/api/login" && req.method === "POST"){
    var din;
    try { din = JSON.parse((await leerCuerpo(req, 4096)).toString("utf8") || "{}"); }
    catch(e){ return json(res,400,{ error:"Datos no v\u00e1lidos" }); }
    if(!hayUsuarios()){
      return json(res,409,{ instalar:true,
        error:"Todav\u00eda no hay ning\u00fan usuario. Crea el primer administrador en esta misma pantalla." });
    }
    var k = claveIntento(req, din.usuario);
    var espera = bloqueado(k);
    if(espera){
      bitacora("BLOQUEADO  " + normUsuario(din.usuario) + "  " + ipDe(req));
      return json(res,429,{ error:"Demasiados intentos fallidos. Espera " + Math.ceil(espera/60) + " minuto(s) e int\u00e9ntalo de nuevo." });
    }
    var usr = verifica(din.usuario, din.clave);
    if(!usr){
      var quedan = fallo(k);
      bitacora("FALLO      " + normUsuario(din.usuario) + "  " + ipDe(req));
      return json(res,401,{ error:"Usuario o contrase\u00f1a incorrectos." + (quedan > 0 && quedan <= 2 ? " Te quedan " + quedan + " intento(s)." : "") });
    }
    exito(k);
    usr.ultimo = Date.now(); guardaUsuarios();
    var token = nuevaSesion(usr, req);
    bitacora("ENTRADA    " + usr.usuario + "  " + ipDe(req));
    res.setHeader("Set-Cookie", cookieSesion(token, false, req));
    return json(res,200,{ ok:true, usuario: usr.usuario, rol: usr.rol });
  }

  /* ---- cierre de sesión ---- */
  if(p === "/api/logout" && req.method === "POST"){
    var ses = sesionDe(req);
    if(ses){ delete sesiones[ses.token]; bitacora("SALIDA     " + ses.usuario + "  " + ipDe(req)); }
    res.setHeader("Set-Cookie", cookieSesion("", true, req));
    return json(res,200,{ ok:true });
  }

  /* ---- quién soy ---- */
  if(p === "/api/yo" && req.method === "GET"){
    var sy = sesionDe(req);
    if(!hayUsuarios()) return json(res,200,{ instalar:true });
    if(!sy) return json(res,401,{ error:"Sin sesi\u00f3n", login:true });
    return json(res,200,{ usuario: sy.usuario, rol: sy.rol, expira: sy.exp });
  }

  /* La página y sus scripts son públicos (no contienen datos); así puede
     mostrarse la pantalla de acceso. Todo /api/ exige sesión. */
  if(p.indexOf("/api/") !== 0) return estatico(req,res,p);

  if(!autorizado(req,res)) return;

  /* ---- cambiar mi propia contraseña ---- */
  if(p === "/api/clave" && req.method === "POST"){
    var dc;
    try { dc = JSON.parse((await leerCuerpo(req, 4096)).toString("utf8") || "{}"); }
    catch(e){ return json(res,400,{ error:"Datos no v\u00e1lidos" }); }
    if(!req.sesion || !req.sesion.usuario) return json(res,400,{ error:"No hay sesi\u00f3n activa." });
    if(!verifica(req.sesion.usuario, dc.actual)) return json(res,401,{ error:"La contrase\u00f1a actual no es correcta." });
    var rc = cambiaClave(req.sesion.usuario, dc.nueva);
    if(rc.error) return json(res,400,{ error: rc.error });
    bitacora("CLAVE      " + req.sesion.usuario + "  " + ipDe(req));
    res.setHeader("Set-Cookie", cookieSesion("", true, req));
    return json(res,200,{ ok:true, aviso:"Contrase\u00f1a cambiada. Vuelve a iniciar sesi\u00f3n." });
  }

  /* ---- lista de usuarios (solo administrador) ---- */
  if(p === "/api/usuarios" && req.method === "GET"){
    if(!soloAdmin(req,res)) return;
    return json(res,200,{ usuarios: usuarios.usuarios.map(function(x){
      return { usuario:x.usuario, rol:x.rol, activo:x.activo, creado:x.creado, ultimo:x.ultimo };
    }) });
  }

  /* ---- crear usuario (solo administrador) ---- */
  if(p === "/api/usuarios" && req.method === "POST"){
    if(!soloAdmin(req,res)) return;
    var dn;
    try { dn = JSON.parse((await leerCuerpo(req, 4096)).toString("utf8") || "{}"); }
    catch(e){ return json(res,400,{ error:"Datos no v\u00e1lidos" }); }
    var rn = creaUsuario(dn.usuario, dn.clave, dn.rol, false);
    if(rn.error) return json(res,400,{ error: rn.error });
    bitacora("NUEVO USR  " + rn.usuario.usuario + "  por " + (req.sesion && req.sesion.usuario));
    return json(res,200,{ ok:true, usuario:{ usuario:rn.usuario.usuario, rol:rn.usuario.rol, activo:true } });
  }

  /* ---- activar / desactivar un usuario (solo administrador) ---- */
  var mEst = p.match(/^\/api\/usuarios\/([a-z0-9._-]{3,32})\/estado$/);
  if(mEst && req.method === "POST"){
    if(!soloAdmin(req,res)) return;
    var de;
    try { de = JSON.parse((await leerCuerpo(req, 1024)).toString("utf8") || "{}"); }
    catch(e){ return json(res,400,{ error:"Datos no v\u00e1lidos" }); }
    var ue = buscaUsuario(mEst[1]);
    if(!ue) return json(res,404,{ error:"Ese usuario no existe." });
    var quiereActivo = !!de.activo;
    if(!quiereActivo){
      if(ue.usuario === (req.sesion && req.sesion.usuario))
        return json(res,400,{ error:"No puedes desactivar tu propia cuenta." });
      var admins = usuarios.usuarios.filter(function(x){ return x.rol === "admin" && x.activo; });
      if(ue.rol === "admin" && admins.length <= 1)
        return json(res,400,{ error:"Debe quedar al menos un administrador activo." });
    }
    ue.activo = quiereActivo;
    if(!quiereActivo) cierraSesionesDe(ue.usuario);
    guardaUsuarios();
    bitacora((quiereActivo ? "ACTIVAR    " : "DESACTIVAR ") + ue.usuario + "  por " + (req.sesion && req.sesion.usuario));
    return json(res,200,{ ok:true, usuario:{ usuario:ue.usuario, rol:ue.rol, activo:ue.activo } });
  }

  /* ---- restablecer la contraseña de otro usuario (solo administrador) ---- */
  var mCl = p.match(/^\/api\/usuarios\/([a-z0-9._-]{3,32})\/clave$/);
  if(mCl && req.method === "POST"){
    if(!soloAdmin(req,res)) return;
    var dr;
    try { dr = JSON.parse((await leerCuerpo(req, 4096)).toString("utf8") || "{}"); }
    catch(e){ return json(res,400,{ error:"Datos no v\u00e1lidos" }); }
    if(!buscaUsuario(mCl[1])) return json(res,404,{ error:"Ese usuario no existe." });
    var rr = cambiaClave(mCl[1], dr.clave);
    if(rr.error) return json(res,400,{ error: rr.error });
    bitacora("RESET CLAVE " + normUsuario(mCl[1]) + "  por " + (req.sesion && req.sesion.usuario));
    return json(res,200,{ ok:true, aviso:"Contrase\u00f1a restablecida. Esa persona debe entrar con la nueva clave." });
  }


  try{
    /* listado */
    if(p === "/api/lotes" && req.method === "GET"){
      var lotes = db.lotes.slice().sort(function(a,b){ return b.creado - a.creado; }).map(pub);
      return json(res, 200, { lotes: lotes });
    }

    /* crear lote + carpeta física */
    if(p === "/api/lotes" && req.method === "POST"){
      var body = JSON.parse((await leerCuerpo(req, 1024*64)).toString("utf8") || "{}");
      var carpeta = limpiaNombre(body.carpeta);
      var nit = limpiaNombre(body.nit);
      var sep = ["_","-"," "].indexOf(body.sep) >= 0 ? body.sep : "_";
      var ruta = limpiaRuta(body.ruta);
      if(!carpeta) return json(res,400,{ error:"Falta el nombre de la carpeta" });
      if(!/^\d{5,15}$/.test(nit)) return json(res,400,{ error:"NIT inválido" });

      var ya = db.lotes.filter(function(l){
        return l.carpeta.toLowerCase() === carpeta.toLowerCase() && l.nit === nit;
      })[0];
      if(ya) return json(res,200,{ lote: pub(ya), existia:true });
      var lote = { id:"L"+Date.now()+crypto.randomBytes(3).toString("hex"),
                   ruta:ruta, carpeta:carpeta, nit:nit, sep:sep, creado:Date.now(), docs:{} };
      db.lotes.push(lote); save();
      return json(res,201,{ lote: pub(lote), existia:false });
    }

    /* documentos */
    var m = p.match(/^\/api\/lotes\/([^\/]+)\/docs\/([A-Za-z]{3})$/);
    if(m){
      var lote2 = db.lotes.filter(function(l){ return l.id === m[1]; })[0];
      var sigla = m[2].toUpperCase();
      if(!lote2) return json(res,404,{ error:"Lote no encontrado" });
      if(SIGLAS.indexOf(sigla) < 0) return json(res,400,{ error:"Sigla no permitida" });

      if(req.method === "POST"){
        var data = await leerCuerpo(req, MAX_PDF);
        if(!data.length) return json(res,400,{ error:"Archivo vacío" });
        if(data.slice(0,5).toString("latin1") !== "%PDF-") return json(res,400,{ error:"El archivo no es un PDF válido" });
        var nombre = nombreArchivo(sigla, lote2.nit, lote2.carpeta, lote2.sep);
        await almacen.escribir(claveDoc(lote2, nombre), data, "application/pdf");
        var orig = "";
        try { orig = decodeURIComponent(req.headers["x-original-name"] || "").slice(0,180); } catch(e){}
        var partes = parseInt(req.headers["x-partes"] || "1", 10);
        var paginas = parseInt(req.headers["x-paginas"] || "0", 10);
        lote2.docs[sigla] = { nombre:nombre, size:data.length, ts:Date.now(), original:orig,
                              partes: (partes > 0 ? partes : 1), paginas: (paginas > 0 ? paginas : 0) };
        save();
        return json(res,200,{ lote: pub(lote2) });
      }
      if(req.method === "GET"){
        var d = lote2.docs[sigla];
        if(!d) return json(res,404,{ error:"Documento no cargado" });
        var buf2 = await almacen.leer(claveDoc(lote2, d.nombre));
        if(!buf2) return json(res,404,{ error:"Archivo no encontrado en el almac\u00e9n" });
        res.writeHead(200, {
          "Content-Type":"application/pdf",
          "Content-Length":buf2.length,
          "Content-Disposition":'attachment; filename="'+d.nombre.replace(/"/g,"")+'"',
          "X-Content-Type-Options":"nosniff"
        });
        return res.end(buf2);
      }
    }

    /* eliminar un lote completo (registro + carpeta con sus PDF) */
    var dl = p.match(/^\/api\/lotes\/([^\/]+)$/);
    if(dl && req.method === "DELETE"){
      var idx = -1;
      db.lotes.forEach(function(l,i){ if(l.id === dl[1]) idx = i; });
      if(idx < 0) return json(res,404,{ error:"Lote no encontrado" });
      var loteD = db.lotes[idx];
      // Solo se vacía la carpeta completa si ningún otro lote la comparte.
      var compartida = db.lotes.some(function(l){
        return l.id !== loteD.id && limpiaNombre(l.carpeta).toLowerCase() === limpiaNombre(loteD.carpeta).toLowerCase();
      });
      var claves = Object.keys(loteD.docs || {}).map(function(sg){ return claveDoc(loteD, loteD.docs[sg].nombre); });
      if(!compartida){
        try {
          var todo = await almacen.listar(PRE_DOCS + limpiaNombre(loteD.carpeta) + "/");
          todo.forEach(function(x){ if(claves.indexOf(x.clave) < 0) claves.push(x.clave); });
        } catch(e){}
      }
      for(var ci=0; ci<claves.length; ci++){ try { await almacen.borrar(claves[ci]); } catch(e){} }
      db.lotes.splice(idx,1); save();
      return json(res,200,{ ok:true, eliminado: loteD.carpeta });
    }

    /* zip de varios lotes seleccionados */
    if(p === "/api/zip" && req.method === "GET"){
      var ids = (u.searchParams.get("ids") || "").split(",").filter(function(s){ return s; });
      if(!ids.length) return json(res,400,{ error:"No se indicaron lotes" });
      var sel = db.lotes.filter(function(l){ return ids.indexOf(l.id) >= 0; });
      if(!sel.length) return json(res,404,{ error:"Lotes no encontrados" });
      var veces = {};
      sel.forEach(function(l){
        var k = l.carpeta.toLowerCase();
        veces[k] = (veces[k] || 0) + 1;
      });
      var itemsM = [];
      for(var si=0; si<sel.length; si++){
        var l = sel[si];
        var base = veces[l.carpeta.toLowerCase()] > 1 ? l.carpeta + "_" + l.nit : l.carpeta;
        var sgs = Object.keys(l.docs || {});
        for(var sj=0; sj<sgs.length; sj++){
          var bufX = null;
          try { bufX = await almacen.leer(claveDoc(l, l.docs[sgs[sj]].nombre)); } catch(e){}
          if(bufX) itemsM.push({ path: base + "/" + l.docs[sgs[sj]].nombre, data: bufX });
        }
      }
      if(!itemsM.length) return json(res,404,{ error:"Los lotes seleccionados no tienen documentos" });
      var bufM = zipBuffer(itemsM);
      var d0 = new Date(), pp = function(n){ return (n<10?"0":"")+n; };
      var znM = "Lotes_" + sel.length + "_" + d0.getFullYear() + pp(d0.getMonth()+1) + pp(d0.getDate()) +
                "_" + pp(d0.getHours()) + pp(d0.getMinutes()) + ".zip";
      res.writeHead(200, {
        "Content-Type":"application/zip",
        "Content-Length":bufM.length,
        "Content-Disposition":'attachment; filename="'+znM+'"'
      });
      return res.end(bufM);
    }

    /* zip del lote */
    var z = p.match(/^\/api\/lotes\/([^\/]+)\/zip$/);
    if(z && req.method === "GET"){
      var lote3 = db.lotes.filter(function(l){ return l.id === z[1]; })[0];
      if(!lote3) return json(res,404,{ error:"Lote no encontrado" });
      var items = [], sgs3 = Object.keys(lote3.docs || {});
      for(var k3=0; k3<sgs3.length; k3++){
        var b3 = null;
        try { b3 = await almacen.leer(claveDoc(lote3, lote3.docs[sgs3[k3]].nombre)); } catch(e){}
        if(b3) items.push({ path: lote3.carpeta + "/" + lote3.docs[sgs3[k3]].nombre, data: b3 });
      }
      if(!items.length) return json(res,404,{ error:"El lote no tiene documentos" });
      var buf = zipBuffer(items);
      var zn = (lote3.carpeta + "_" + lote3.nit + ".zip").replace(/[^\w.\-]/g,"_");
      res.writeHead(200, {
        "Content-Type":"application/zip",
        "Content-Length":buf.length,
        "Content-Disposition":'attachment; filename="'+zn+'"'
      });
      return res.end(buf);
    }

    /* copia de seguridad completa: todos los PDF + el inventario */
    if(p === "/api/copia" && req.method === "GET"){
      if(!soloAdmin(req,res)) return;
      var itemsC = [], falt = 0;
      for(var li=0; li<db.lotes.length; li++){
        var lc = db.lotes[li], sgc = Object.keys(lc.docs || {});
        for(var lj=0; lj<sgc.length; lj++){
          var bc = null;
          try { bc = await almacen.leer(claveDoc(lc, lc.docs[sgc[lj]].nombre)); } catch(e){}
          if(bc) itemsC.push({ path: "documentos/" + limpiaNombre(lc.carpeta) + "/" + lc.docs[sgc[lj]].nombre, data: bc });
          else falt++;
        }
      }
      itemsC.push({ path:"inventario.json", data: Buffer.from(JSON.stringify(db, null, 2), "utf8") });
      /* Resumen legible del contenido de la copia. */
      var lineas = ["Copia de seguridad del Sistema de Gesti\u00f3n Documental",
                    "Fecha: " + new Date().toLocaleString(),
                    "Carpetas registradas: " + db.lotes.length,
                    "Documentos incluidos: " + (itemsC.length - 1),
                    "Documentos no encontrados: " + falt,
                    "",
                    "Contiene datos personales de pacientes: gu\u00e1rdala en un lugar seguro",
                    "y no la compartas por canales p\u00fablicos (Ley 1581 de 2012)."];
      itemsC.push({ path:"LEEME-copia.txt", data: Buffer.from(lineas.join("\n"), "utf8") });
      var bufC = zipBuffer(itemsC);
      var dC = new Date(), ppC = function(n){ return (n<10?"0":"")+n; };
      var znC = "Copia_completa_" + dC.getFullYear() + ppC(dC.getMonth()+1) + ppC(dC.getDate()) +
                "_" + ppC(dC.getHours()) + ppC(dC.getMinutes()) + ".zip";
      bitacora("COPIA      completa (" + (itemsC.length-2) + " PDF) por " + (req.sesion && req.sesion.usuario));
      res.writeHead(200, {
        "Content-Type":"application/zip",
        "Content-Length":bufC.length,
        "Content-Disposition":'attachment; filename="'+znC+'"'
      });
      return res.end(bufC);
    }

    if(p.indexOf("/api/") === 0) return json(res,404,{ error:"Ruta no válida" });
    return estatico(req,res,p);
  }catch(err){
    return json(res,500,{ error: err && err.message ? err.message : "Error interno" });
  }
});

/* ================================================================== *
 * ARRANQUE
 * Primero se leen los datos guardados (nube o disco) y solo después se
 * abre el servidor o se ejecuta un comando de consola.
 * ================================================================== */
(async function arrancar(){
  if(EN_NUBE){
    var ok = await nube.comprobar();
    if(!ok.ok){
      console.error("\u2716 No se pudo conectar con el almacenamiento en la nube: " + ok.error);
      console.error("  Revisa las variables R2_* y vuelve a desplegar. El servicio no arranca");
      console.error("  para no guardar datos que luego se perder\u00edan.");
      process.exit(1);
    }
  }
  await cargarDatos();

  /* primer arranque: sembrar usuario desde variables de entorno */
  if(!usuarios.usuarios.length && PASS){
    var sembrado = creaUsuario(USER, PASS, "admin", true);
    if(sembrado.error) console.error("No se pudo crear el usuario inicial: " + sembrado.error);
    else {
      console.log('Usuario inicial creado: "' + sembrado.usuario.usuario + '" (administrador).');
      try { await guardaUsuariosYa(); } catch(e){}
    }
  }

  if(cmd) return comandosConsola();

  servidor.listen(PORT, function(){
    console.log("Servidor listo en el puerto " + PORT + (TRAS_PROXY ? " (detr\u00e1s de proxy/HTTPS)" : " -> http://localhost:" + PORT));
    console.log("Los datos se guardan en: " + nube.describe().detalle);
    if(!EN_NUBE){
      console.log("\u26a0  Aviso: sin almacenamiento en la nube configurado, en servidores");
      console.log("   gratuitos (Render y similares) los archivos pueden perderse al reiniciar.");
      console.log("   Configura las variables R2_* para conservarlos (ver LEEME.md).");
    }
    if(!hayUsuarios()){
      console.log("\n\u26a0  Todav\u00eda no hay ning\u00fan usuario creado: el acceso est\u00e1 BLOQUEADO.");
      console.log("   Abre la app en el navegador y usa \"Crear el primer administrador\"");
      console.log("   para registrarlo. Tambi\u00e9n puedes hacerlo por consola con:");
      console.log("   node server.js nuevo-usuario admin TuClave1234 admin\n");
    } else {
      console.log("Acceso protegido: " + usuarios.usuarios.length + " usuario(s) registrado(s).");
      console.log("La sesi\u00f3n se cierra tras " + (SES_MS/3600000) + " h de inactividad.");
    }
  });
})();
