/* ============================================================================
   NEXUSMED · Servidor estático mínimo (para Render u otro hosting Node)
   No necesita dependencias externas: usa solo módulos nativos de Node.
   Sirve los archivos de esta carpeta (index.html, app.js, nube.js, styles.css…)
   y escucha en el puerto que indique el entorno (Render fija process.env.PORT).
   La app es "solo navegador"; este servidor únicamente entrega los archivos.
   ========================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.sql':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2'
};

/* Cabeceras de seguridad aplicadas a TODA respuesta. */
const SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; ')
};
function aplicarSeguridad(res){ for(var k in SEGURIDAD){ try{ res.setHeader(k, SEGURIDAD[k]); }catch(_){ } } }

const server = http.createServer((req, res) => {
  /* Escudos de seguridad del navegador (no afectan el funcionamiento de la
     app; solo endurecen cómo el navegador trata la página). La CSP permite
     exactamente lo que la app necesita: scripts propios + supabase-js (CDN),
     conexión a la nube Supabase (REST y tiempo real), e imágenes de
     firma/logo en base64. */
  aplicarSeguridad(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }
  let urlPath = decodeURIComponent((req.url.split('?')[0] || '/'));
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const safe = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      const fallback = path.join(ROOT, 'index.html');
      fs.readFile(fallback, (e2, buf) => {
        if (e2) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': TIPOS['.html'] });
        res.end(req.method === 'HEAD' ? undefined : buf);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const tipo = TIPOS[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': tipo });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('NEXUSMED escuchando en el puerto ' + PORT);
});
