/*
 * PORTERO DE ACCESO (auth-gate.js)
 * ---------------------------------------------------------------
 * Se coloca DELANTE de tu programa. Nadie ve la aplicacion si no
 * escribe usuario y contrasena. La clave se revisa en el SERVIDOR,
 * no en el navegador, por eso no se puede saltar desde internet.
 *
 * No necesita instalar nada (solo modulos propios de Node).
 *
 * Como funciona:
 *   1. Este archivo arranca tu servidor original en un puerto interno
 *      (server.js / app.js / index.js, o el que indiques en APP_ENTRY).
 *   2. Escucha el puerto publico de internet.
 *   3. Si la visita no tiene sesion valida -> muestra la pantalla de acceso.
 *   4. Si la sesion es valida -> reenvia todo a tu programa tal cual.
 *
 * Variables recomendadas en el panel del servidor (Render):
 *   APP_USERS       usuario:clave separados por coma
 *                   ejemplo: jorge:MiClave2026,auditor:Otra2026
 *   SESSION_SECRET  cualquier texto largo al azar (firma las sesiones)
 *   SESSION_HOURS   horas que dura la sesion (por defecto 8)
 *   APP_ENTRY       nombre del archivo de tu servidor (si no se detecta)
 */

'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ---------------------------------------------------------------
// 1. Configuracion
// ---------------------------------------------------------------

const PUERTO_PUBLICO = Number(process.env.PORT) || 10000;
const PUERTO_INTERNO = Number(process.env.INTERNAL_PORT) || 3101;
const HORAS_SESION = Number(process.env.SESSION_HOURS) || 8;
const COOKIE = 'gd_sesion';
const MAX_INTENTOS = 5;
const ESPERA_BLOQUEO_MS = 60 * 1000;

const SECRETO =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SECRETO_TEMPORAL = !process.env.SESSION_SECRET;

// Usuarios: 1) variable APP_USERS  2) archivo usuarios.json  3) por defecto
function cargarUsuarios() {
  const texto = (process.env.APP_USERS || '').trim();
  if (texto) {
    const lista = {};
    for (const par of texto.split(',')) {
      const i = par.indexOf(':');
      if (i > 0) {
        const u = par.slice(0, i).trim();
        const c = par.slice(i + 1).trim();
        if (u && c) lista[u.toLowerCase()] = c;
      }
    }
    if (Object.keys(lista).length) return { lista, porDefecto: false };
  }

  const archivo = path.join(__dirname, 'usuarios.json');
  try {
    if (fs.existsSync(archivo)) {
      const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
      const lista = {};
      for (const u of Object.keys(datos)) {
        if (u && datos[u]) lista[u.toLowerCase()] = String(datos[u]);
      }
      if (Object.keys(lista).length) return { lista, porDefecto: false };
    }
  } catch (e) {
    console.error('[portero] usuarios.json no se pudo leer:', e.message);
  }

  return { lista: { jorge: 'Cambiar2026*' }, porDefecto: true };
}

const { lista: USUARIOS, porDefecto: CLAVE_POR_DEFECTO } = cargarUsuarios();

// ---------------------------------------------------------------
// 2. Sesiones firmadas (cookie con firma HMAC, no se puede falsificar)
// ---------------------------------------------------------------

function firmar(dato) {
  return crypto.createHmac('sha256', SECRETO).update(dato).digest('base64url');
}

function crearSesion(usuario) {
  const vence = Date.now() + HORAS_SESION * 3600 * 1000;
  const cuerpo = Buffer.from(`${usuario}|${vence}`, 'utf8').toString('base64url');
  return `${cuerpo}.${firmar(cuerpo)}`;
}

function leerSesion(valor) {
  if (!valor || typeof valor !== 'string') return null;
  const p = valor.lastIndexOf('.');
  if (p <= 0) return null;
  const cuerpo = valor.slice(0, p);
  const firma = valor.slice(p + 1);
  if (!igual(firma, firmar(cuerpo))) return null;
  let texto;
  try {
    texto = Buffer.from(cuerpo, 'base64url').toString('utf8');
  } catch (e) {
    return null;
  }
  const corte = texto.lastIndexOf('|');
  if (corte <= 0) return null;
  const usuario = texto.slice(0, corte);
  const vence = Number(texto.slice(corte + 1));
  if (!Number.isFinite(vence) || Date.now() > vence) return null;
  if (!USUARIOS[usuario]) return null;
  return { usuario, vence };
}

function igual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function leerCookies(cabecera) {
  const salida = {};
  if (!cabecera) return salida;
  for (const trozo of cabecera.split(';')) {
    const i = trozo.indexOf('=');
    if (i > 0) {
      salida[trozo.slice(0, i).trim()] = decodeURIComponent(
        trozo.slice(i + 1).trim()
      );
    }
  }
  return salida;
}

function esSeguro(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0];
  return proto.trim() === 'https';
}

function cookieSesion(req, valor, segundos) {
  const partes = [
    `${COOKIE}=${valor}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${segundos}`,
  ];
  if (esSeguro(req)) partes.push('Secure');
  return partes.join('; ');
}

// ---------------------------------------------------------------
// 3. Freno contra adivinar contrasenas
// ---------------------------------------------------------------

const intentos = new Map();

function quienEs(req) {
  const reenviado = String(req.headers['x-forwarded-for'] || '').split(',')[0];
  return reenviado.trim() || req.socket.remoteAddress || 'desconocido';
}

function bloqueado(ip) {
  const dato = intentos.get(ip);
  if (!dato) return 0;
  if (dato.hasta > Date.now()) return Math.ceil((dato.hasta - Date.now()) / 1000);
  return 0;
}

function fallo(ip) {
  const dato = intentos.get(ip) || { veces: 0, hasta: 0 };
  dato.veces += 1;
  if (dato.veces >= MAX_INTENTOS) {
    dato.hasta = Date.now() + ESPERA_BLOQUEO_MS;
    dato.veces = 0;
  }
  intentos.set(ip, dato);
}

function acierto(ip) {
  intentos.delete(ip);
}

// ---------------------------------------------------------------
// 4. Pantalla de acceso (HTML sin scripts)
// ---------------------------------------------------------------

function escapar(t) {
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paginaAcceso(aviso, destino) {
  const alerta = aviso
    ? `<p class="error">${escapar(aviso)}</p>`
    : '';
  const recordatorio = CLAVE_POR_DEFECTO
    ? `<p class="nota">Atencion: todavia no has configurado tus usuarios. Se esta usando la clave inicial. Configura APP_USERS en el panel del servidor cuanto antes.</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Acceso restringido</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: 'Segoe UI', Tahoma, sans-serif;
         background: linear-gradient(135deg,#0f2027,#203a43,#2c5364); padding:20px; }
  .caja { background:#fff; width:100%; max-width:410px; border-radius:14px; padding:34px 30px;
          box-shadow:0 18px 45px rgba(0,0,0,.35); }
  .candado { font-size:44px; text-align:center; margin-bottom:6px; }
  h1 { font-size:21px; margin:0 0 6px; text-align:center; color:#12303f; }
  p.sub { margin:0 0 22px; text-align:center; color:#5d6b74; font-size:13.5px; line-height:1.5; }
  label { display:block; font-size:13px; font-weight:600; color:#22404f; margin:14px 0 6px; }
  input { width:100%; padding:12px 13px; border:1px solid #cfd8dd; border-radius:8px; font-size:15px; }
  input:focus { outline:none; border-color:#2c7da0; box-shadow:0 0 0 3px rgba(44,125,160,.18); }
  button { width:100%; margin-top:22px; padding:13px; border:0; border-radius:8px; cursor:pointer;
           background:#1a6985; color:#fff; font-size:15.5px; font-weight:600; }
  button:hover { background:#125870; }
  .error { background:#fdecea; border:1px solid #f5c2bd; color:#a32b1c; padding:10px 12px;
           border-radius:8px; font-size:13.5px; margin:0 0 14px; }
  .nota { background:#fff8e1; border:1px solid #f2dfa4; color:#7a5c11; padding:10px 12px;
          border-radius:8px; font-size:12.5px; margin:16px 0 0; line-height:1.5; }
  .pie { margin-top:20px; text-align:center; font-size:11.5px; color:#8b979e; line-height:1.6; }
</style>
</head>
<body>
  <main class="caja">
    <div class="candado" aria-hidden="true">&#128274;</div>
    <h1>Acceso restringido</h1>
    <p class="sub">Gestion Documental y Nomenclatura Automatizada<br>Escribe tu usuario y contrasena para continuar.</p>
    ${alerta}
    <form method="POST" action="/__acceso" autocomplete="off">
      <input type="hidden" name="destino" value="${escapar(destino || '/')}">
      <label for="usuario">Usuario</label>
      <input id="usuario" name="usuario" type="text" required autofocus autocapitalize="none" spellcheck="false">
      <label for="clave">Contrasena</label>
      <input id="clave" name="clave" type="password" required>
      <button type="submit">Entrar</button>
    </form>
    ${recordatorio}
    <p class="pie">Los datos clinicos son confidenciales.<br>Cada intento de acceso queda registrado.</p>
  </main>
</body>
</html>`;
}

function responderHtml(res, codigo, html, cabeceras) {
  res.writeHead(codigo, Object.assign({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }, cabeceras || {}));
  res.end(html);
}

// ---------------------------------------------------------------
// 5. Arrancar tu programa original en un puerto interno
// ---------------------------------------------------------------

function buscarEntrada() {
  if (process.env.APP_ENTRY) return process.env.APP_ENTRY;
  const yo = path.basename(__filename);
  const candidatos = ['server.js', 'app.js', 'index.js', 'main.js', 'servidor.js'];
  for (const nombre of candidatos) {
    if (nombre !== yo && fs.existsSync(path.join(__dirname, nombre))) return nombre;
  }
  return null;
}

const ENTRADA = buscarEntrada();
let hijo = null;

if (ENTRADA) {
  console.log(`[portero] arrancando tu programa: ${ENTRADA} (puerto interno ${PUERTO_INTERNO})`);
  hijo = spawn(process.execPath, [ENTRADA], {
    cwd: __dirname,
    stdio: 'inherit',
    env: Object.assign({}, process.env, {
      PORT: String(PUERTO_INTERNO),
      INTERNAL_PORT: String(PUERTO_INTERNO),
      HOST: '127.0.0.1',
    }),
  });
  hijo.on('exit', (codigo) => {
    console.error(`[portero] tu programa se cerro (codigo ${codigo}).`);
    process.exit(codigo === null ? 1 : codigo);
  });
  const cerrar = () => { try { hijo.kill(); } catch (e) {} process.exit(0); };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
} else {
  console.error('[portero] No encontre el archivo de tu servidor. Indica su nombre en la variable APP_ENTRY.');
}

// Averigua en que puerto quedo escuchando tu programa
let puertoDetectado = null;
const PUERTOS_POSIBLES = [PUERTO_INTERNO, 3000, 3001, 8080, 5000, 4000, 8000];

function probarPuerto(puerto) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port: puerto });
    s.setTimeout(700);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => { s.destroy(); resolve(false); });
  });
}

async function detectarPuerto() {
  if (puertoDetectado && (await probarPuerto(puertoDetectado))) return puertoDetectado;
  for (const p of PUERTOS_POSIBLES) {
    if (p === PUERTO_PUBLICO) continue;
    if (await probarPuerto(p)) { puertoDetectado = p; return p; }
  }
  return null;
}

// ---------------------------------------------------------------
// 6. Reenvio hacia tu programa (una vez autenticado)
// ---------------------------------------------------------------

async function reenviar(req, res, usuario) {
  const puerto = await detectarPuerto();
  if (!puerto) {
    responderHtml(res, 503,
      '<h1>El programa esta iniciando</h1><p>Espera unos segundos y actualiza la pagina.</p>');
    return;
  }

  const cabeceras = Object.assign({}, req.headers);
  delete cabeceras['accept-encoding'];
  cabeceras.host = `127.0.0.1:${puerto}`;
  cabeceras['x-usuario'] = usuario;

  // no dejamos pasar nuestra cookie de sesion al programa interno
  if (cabeceras.cookie) {
    const limpio = cabeceras.cookie
      .split(';')
      .filter((c) => !c.trim().toLowerCase().startsWith(`${COOKIE}=`))
      .join(';')
      .trim();
    if (limpio) cabeceras.cookie = limpio;
    else delete cabeceras.cookie;
  }

  const peticion = http.request(
    { host: '127.0.0.1', port: puerto, method: req.method, path: req.url, headers: cabeceras },
    (respuesta) => {
      const salida = Object.assign({}, respuesta.headers);
      res.writeHead(respuesta.statusCode || 502, salida);
      respuesta.pipe(res);
    }
  );

  peticion.on('error', (e) => {
    puertoDetectado = null;
    if (!res.headersSent) {
      responderHtml(res, 502,
        `<h1>No pude comunicarme con el programa</h1><p>${escapar(e.message)}</p>`);
    } else {
      res.end();
    }
  });

  req.pipe(peticion);
}

// ---------------------------------------------------------------
// 7. Servidor publico
// ---------------------------------------------------------------

function leerCuerpo(req, limite = 8 * 1024) {
  return new Promise((resolve) => {
    let datos = '';
    let exceso = false;
    req.on('data', (trozo) => {
      if (exceso) return;
      datos += trozo;
      if (datos.length > limite) { exceso = true; datos = ''; }
    });
    req.on('end', () => resolve(datos));
    req.on('error', () => resolve(''));
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://interno');
  const ruta = url.pathname;
  const sesion = leerSesion(leerCookies(req.headers.cookie)[COOKIE]);

  // --- salir ---
  if (ruta === '/__salir' || ruta === '/salir' || ruta === '/logout') {
    responderHtml(res, 200, paginaAcceso('Has cerrado la sesion correctamente.', '/'), {
      'Set-Cookie': cookieSesion(req, '', 0),
    });
    return;
  }

  // --- quien esta dentro (util para mostrarlo en pantalla) ---
  if (ruta === '/__usuario') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(sesion ? { activo: true, usuario: sesion.usuario } : { activo: false }));
    return;
  }

  // --- formulario de acceso ---
  if (ruta === '/__acceso') {
    if (req.method === 'GET') {
      responderHtml(res, 200, paginaAcceso('', url.searchParams.get('destino') || '/'));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'GET, POST' });
      res.end();
      return;
    }

    const ip = quienEs(req);
    const espera = bloqueado(ip);
    if (espera) {
      responderHtml(res, 429,
        paginaAcceso(`Demasiados intentos fallidos. Espera ${espera} segundos.`, '/'));
      return;
    }

    const cuerpo = await leerCuerpo(req);
    const campos = new URLSearchParams(cuerpo);
    const usuario = (campos.get('usuario') || '').trim().toLowerCase();
    const clave = campos.get('clave') || '';
    let destino = campos.get('destino') || '/';
    if (!destino.startsWith('/') || destino.startsWith('//')) destino = '/';

    const guardada = USUARIOS[usuario];
    if (guardada && igual(clave, guardada)) {
      acierto(ip);
      console.log(`[portero] entro "${usuario}" desde ${ip}`);
      res.writeHead(302, {
        Location: destino,
        'Set-Cookie': cookieSesion(req, crearSesion(usuario), HORAS_SESION * 3600),
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    fallo(ip);
    console.warn(`[portero] intento fallido de "${usuario}" desde ${ip}`);
    await new Promise((r) => setTimeout(r, 600));
    responderHtml(res, 401, paginaAcceso('Usuario o contrasena incorrectos.', destino));
    return;
  }

  // --- todo lo demas exige sesion ---
  if (!sesion) {
    const quiereHtml = String(req.headers.accept || '').includes('text/html');
    if (req.method === 'GET' && quiereHtml) {
      responderHtml(res, 401, paginaAcceso('', ruta + (url.search || '')));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Sesion requerida. Vuelve a entrar con tu usuario y contrasena.' }));
    }
    return;
  }

  reenviar(req, res, sesion.usuario);
});

servidor.listen(PUERTO_PUBLICO, () => {
  console.log(`[portero] acceso protegido escuchando en el puerto ${PUERTO_PUBLICO}`);
  console.log(`[portero] usuarios cargados: ${Object.keys(USUARIOS).join(', ')}`);
  if (CLAVE_POR_DEFECTO) console.warn('[portero] AVISO: usando clave inicial. Configura APP_USERS.');
  if (SECRETO_TEMPORAL) console.warn('[portero] AVISO: sin SESSION_SECRET, las sesiones se cierran en cada reinicio.');
});
