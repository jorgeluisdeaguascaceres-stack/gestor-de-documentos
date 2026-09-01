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
 */
"use strict";

var http = require("http");
var fs   = require("fs");
var path = require("path");
var crypto = require("crypto");

var PORT     = parseInt(process.env.PORT || "8080", 10);
var DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
var WEB_DIR  = __dirname;
var USER     = process.env.APP_USER || "admin";
var PASS     = process.env.APP_PASSWORD || "";
var DB_FILE  = path.join(DATA_DIR, "db.json");
var USU_FILE = path.join(DATA_DIR, "usuarios.json");
var LOG_FILE = path.join(DATA_DIR, "bitacora.log");
var SES_MS   = Math.max(1, parseFloat(process.env.SESION_HORAS || "8")) * 3600 * 1000;
var MAX_PDF  = 60 * 1024 * 1024;

/* Detrás de un proxy (Render, Railway, Fly, Nginx) la IP real y el protocolo
 * llegan en cabeceras. Se activa solo, o a mano con TRAS_PROXY=1 / =0. */
var TRAS_PROXY = process.env.TRAS_PROXY
  ? process.env.TRAS_PROXY !== "0"
  : !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME);

var SIGLAS = ["CRC","AUT","HEV","FEV","OPF","EPI"];

/* ---------------- base de datos (JSON en disco) ---------------- */
fs.mkdirSync(DATA_DIR, { recursive:true });
var db = { lotes:[] };
try { if(fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE,"utf8")); } catch(e){}
if(!db.lotes) db.lotes = [];
var saving = false, dirty = false;
function save(){
  if(saving){ dirty = true; return; }
  saving = true;
  var tmp = DB_FILE + ".tmp";
  fs.writeFile(tmp, JSON.stringify(db,null,2), function(err){
    if(!err){ try { fs.renameSync(tmp, DB_FILE); } catch(e){} }
    saving = false;
    if(dirty){ dirty = false; save(); }
  });
}

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
function dirDe(lote){
  // En el servidor central cada lote es una carpeta con su nombre,
  // dentro de la carpeta de datos del propio servidor.
  var abs = path.resolve(DATA_DIR, limpiaNombre(lote.carpeta));
  if(abs !== DATA_DIR && abs.indexOf(DATA_DIR + path.sep) !== 0) throw new Error("Ruta no permitida");
  return abs;
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
try {
  if(fs.existsSync(USU_FILE)) usuarios = JSON.parse(fs.readFileSync(USU_FILE,"utf8"));
} catch(e){ console.error("usuarios.json ilegible, se ignora: " + e.message); }
if(!Array.isArray(usuarios.usuarios)) usuarios.usuarios = [];

function guardaUsuarios(){
  var tmp = USU_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(usuarios,null,2), { mode:0o600 });
  fs.renameSync(tmp, USU_FILE);
  try { fs.chmodSync(USU_FILE, 0o600); } catch(e){}
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

/* --- primer arranque: sembrar usuario desde variables de entorno --- */
if(!usuarios.usuarios.length && PASS){
  var sembrado = creaUsuario(USER, PASS, "admin", true);
  if(sembrado.error) console.error("No se pudo crear el usuario inicial: " + sembrado.error);
  else console.log('Usuario inicial creado: "' + sembrado.usuario.usuario + '" (administrador).');
}

/* ---------------- bitácora de accesos ---------------- */
function bitacora(texto){
  fs.appendFile(LOG_FILE, new Date().toISOString() + "  " + texto + "\n", function(){});
}

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
if(cmd){
  var a1 = process.argv[3], a2 = process.argv[4], a3 = process.argv[5];
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
    process.exit(0);
  }
  if(cmd === "nuevo-usuario"){
    if(!a1 || !a2){ console.log("Uso: node server.js nuevo-usuario <usuario> <clave> [admin|auditor]"); process.exit(1); }
    var r1 = creaUsuario(a1, a2, a3 || "auditor", false);
    console.log(r1.error ? "\u2716 " + r1.error : '\u2714 Usuario "' + r1.usuario.usuario + '" creado (' + r1.usuario.rol + ").");
    process.exit(r1.error ? 1 : 0);
  }
  if(cmd === "clave"){
    if(!a1 || !a2){ console.log("Uso: node server.js clave <usuario> <nueva-clave>"); process.exit(1); }
    var r2 = cambiaClave(a1, a2);
    console.log(r2.error ? "\u2716 " + r2.error : "\u2714 Contrase\u00f1a actualizada para " + normUsuario(a1) + ".");
    process.exit(r2.error ? 1 : 0);
  }
  if(cmd === "activar" || cmd === "desactivar"){
    var u4 = buscaUsuario(a1);
    if(!u4){ console.log("\u2716 Ese usuario no existe."); process.exit(1); }
    u4.activo = (cmd === "activar");
    if(!u4.activo) cierraSesionesDe(u4.usuario);
    guardaUsuarios();
    console.log("\u2714 " + u4.usuario + " ahora est\u00e1 " + (u4.activo ? "activo" : "inactivo") + ".");
    process.exit(0);
  }
  if(cmd === "borrar-usuario"){
    var n5 = normUsuario(a1), antes = usuarios.usuarios.length;
    usuarios.usuarios = usuarios.usuarios.filter(function(x){ return x.usuario !== n5; });
    if(usuarios.usuarios.length === antes){ console.log("\u2716 Ese usuario no existe."); process.exit(1); }
    cierraSesionesDe(n5);
    guardaUsuarios();
    console.log("\u2714 Usuario " + n5 + " eliminado.");
    process.exit(0);
  }
  console.log("Comandos disponibles: usuarios | nuevo-usuario | clave | activar | desactivar | borrar-usuario");
  process.exit(1);
}

/* ---------------- servidor ---------------- */
http.createServer(async function(req,res){
  var u = new URL(req.url, "http://x");
  var p = decodeURIComponent(u.pathname);

  if(p === "/api/health"){
    var s0 = sesionDe(req);
    return json(res, 200, {
      ok:true,
      auth: hayUsuarios(),
      instalar: !hayUsuarios(),
      nube: true,
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
      if(ya){
        fs.mkdirSync(dirDe(ya), { recursive:true });
        return json(res,200,{ lote: pub(ya), existia:true });
      }
      var lote = { id:"L"+Date.now()+crypto.randomBytes(3).toString("hex"),
                   ruta:ruta, carpeta:carpeta, nit:nit, sep:sep, creado:Date.now(), docs:{} };
      fs.mkdirSync(dirDe(lote), { recursive:true });
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
        var dir = dirDe(lote2);
        fs.mkdirSync(dir, { recursive:true });
        fs.writeFileSync(path.join(dir, nombre), data);
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
        var f = path.join(dirDe(lote2), d.nombre);
        if(!fs.existsSync(f)) return json(res,404,{ error:"Archivo no encontrado en el servidor" });
        res.writeHead(200, {
          "Content-Type":"application/pdf",
          "Content-Length":fs.statSync(f).size,
          "Content-Disposition":'attachment; filename="'+d.nombre.replace(/"/g,"")+'"',
          "X-Content-Type-Options":"nosniff"
        });
        return fs.createReadStream(f).pipe(res);
      }
    }

    /* eliminar un lote completo (registro + carpeta con sus PDF) */
    var dl = p.match(/^\/api\/lotes\/([^\/]+)$/);
    if(dl && req.method === "DELETE"){
      var idx = -1;
      db.lotes.forEach(function(l,i){ if(l.id === dl[1]) idx = i; });
      if(idx < 0) return json(res,404,{ error:"Lote no encontrado" });
      var loteD = db.lotes[idx];
      var dirD = dirDe(loteD);
      // Solo se borra la carpeta del lote si ningún otro lote la comparte.
      var compartida = db.lotes.some(function(l){
        return l.id !== loteD.id && limpiaNombre(l.carpeta).toLowerCase() === limpiaNombre(loteD.carpeta).toLowerCase();
      });
      if(compartida){
        Object.keys(loteD.docs || {}).forEach(function(sg){
          try { fs.unlinkSync(path.join(dirD, loteD.docs[sg].nombre)); } catch(e){}
        });
      } else {
        try { fs.rmSync(dirD, { recursive:true, force:true }); } catch(e){}
      }
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
      sel.forEach(function(l){
        var base = veces[l.carpeta.toLowerCase()] > 1 ? l.carpeta + "_" + l.nit : l.carpeta;
        var dl2 = dirDe(l);
        Object.keys(l.docs || {}).forEach(function(sg){
          var f = path.join(dl2, l.docs[sg].nombre);
          if(fs.existsSync(f)) itemsM.push({ path: base + "/" + l.docs[sg].nombre, data: fs.readFileSync(f) });
        });
      });
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
      var dir3 = dirDe(lote3), items = [];
      Object.keys(lote3.docs).forEach(function(sg){
        var f = path.join(dir3, lote3.docs[sg].nombre);
        if(fs.existsSync(f)) items.push({ path: lote3.carpeta + "/" + lote3.docs[sg].nombre, data: fs.readFileSync(f) });
      });
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

    if(p.indexOf("/api/") === 0) return json(res,404,{ error:"Ruta no válida" });
    return estatico(req,res,p);
  }catch(err){
    return json(res,500,{ error: err && err.message ? err.message : "Error interno" });
  }
}).listen(PORT, function(){
  console.log("Servidor listo en el puerto " + PORT + (TRAS_PROXY ? " (detrás de proxy/HTTPS)" : " -> http://localhost:" + PORT));
  console.log("Carpetas y PDFs se guardan en: " + DATA_DIR);
  if(!hayUsuarios()){
    console.log("\n⚠  Todavía no hay ningún usuario creado: el acceso está BLOQUEADO.");
    console.log("   Abre la app en el navegador y usa \"Crear el primer administrador\"");
    console.log("   para registrarlo. También puedes hacerlo por consola con:");
    console.log("   node server.js nuevo-usuario admin TuClave1234 admin\n");
  } else {
    console.log("Acceso protegido: " + usuarios.usuarios.length + " usuario(s) registrado(s).");
    console.log("La sesión se cierra tras " + (SES_MS/3600000) + " h de inactividad.");
  }
});
