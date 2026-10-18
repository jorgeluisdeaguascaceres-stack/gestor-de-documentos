/* ============================================================
   nexus_merge.js  (compartido backend)
   Motor de fusión de datos para la base compartida de NexusMed.

   Idea: cada PC manda su copia de los "almacenes" (pacientes, CUPS,
   EPS, citas, etc.) y sus "borrados" (tombstones). El servidor los
   fusiona registro por registro con el documento maestro guardado en
   Drive, sin perder información:
     - Se identifican los registros por id (o documento / codigo).
     - Si el mismo registro viene de dos lados, gana el de marca de
       tiempo _sm (sync-modified) más reciente.
     - Un borrado (tombstone) con fecha >= a la última edición elimina
       el registro en todas las sedes.
   Es aditivo y seguro: ante la duda, conserva el dato.
   ============================================================ */
'use strict';

function claveDeRegistro(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.id !== undefined && r.id !== null && r.id !== '') return 'id:' + r.id;
  if (r.documento) return 'doc:' + String(r.documento).trim();
  if (r.codigoCUPS) return 'cup:' + String(r.codigoCUPS).trim();
  if (r.codigo) return 'cod:' + String(r.codigo).trim();
  // último recurso: huella del contenido
  try { return 'js:' + JSON.stringify(r); } catch (e) { return null; }
}

function ts(r) { return (r && Number(r._sm)) || 0; }

function _vacio(v) { return v === undefined || v === null || (typeof v === 'string' && v.trim() === ''); }

/* Funde dos versiones del MISMO registro conservando los campos no vacíos.
   Gana el más reciente, pero si al ganador le FALTA un campo (p. ej. el
   NOMBRE) y el otro lo tenía con valor, se conserva. Así una copia parcial o
   vacía que llegue de otro PC NUNCA borra un nombre ya guardado.
   "Ante la duda, conserva el dato." */
function combinarPreservando(ganador, perdedor) {
  if (!ganador || typeof ganador !== 'object') return ganador;
  if (!perdedor || typeof perdedor !== 'object') return ganador;
  var out = {}, k;
  for (k in perdedor) out[k] = perdedor[k];
  for (k in ganador) if (!_vacio(ganador[k])) out[k] = ganador[k];
  out._sm = ts(ganador) || out._sm;
  return out;
}

/* Fusiona dos arreglos de registros + tombstones de ese almacén.
   tombs: objeto { claveRegistro: fechaBorradoMs } */
function fusionarArreglo(servidor, cliente, tombs) {
  servidor = Array.isArray(servidor) ? servidor : [];
  cliente = Array.isArray(cliente) ? cliente : [];
  tombs = tombs || {};
  var mapa = new Map();
  servidor.forEach(function (r) { var k = claveDeRegistro(r); if (k) mapa.set(k, r); });
  cliente.forEach(function (r) {
    var k = claveDeRegistro(r); if (!k) return;
    var ex = mapa.get(k);
    if (!ex) { mapa.set(k, r); return; }
    // Gana el más reciente, PERO conservando los campos no vacíos del otro.
    if (ts(r) >= ts(ex)) mapa.set(k, combinarPreservando(r, ex));
    else mapa.set(k, combinarPreservando(ex, r));
  });
  var out = [];
  mapa.forEach(function (r, k) {
    var tomb = tombs[k];
    if (tomb && Number(tomb) >= ts(r)) return; // borrado más nuevo que la edición
    out.push(r);
  });
  return out;
}

/* Fusiona el mapa de tombstones (gana la fecha de borrado mayor). */
function fusionarTombstones(a, b) {
  var out = {};
  [a || {}, b || {}].forEach(function (src) {
    Object.keys(src).forEach(function (k) {
      if (!out[k] || Number(src[k]) > Number(out[k])) out[k] = Number(src[k]);
    });
  });
  return out;
}

/* Fusiona el documento maestro completo con lo que envía un cliente.
   master  = { version, actualizado, stores:{k:valor}, tombstones:{k:{clave:ts}} }
   entrada = { stores:{k:valor}, tombstones:{k:{clave:ts}} }
   Para arreglos: fusión registro por registro.
   Para escalares/objetos (ej. contador, datos IPS): gana el de fecha
   mayor si viene marca _sm; si no, se conserva el del cliente cuando
   lo envía (last-write-wins simple). */
function fusionarMaestro(master, entrada) {
  master = master && typeof master === 'object' ? master : {};
  var mStores = master.stores || {};
  var mTombs = master.tombstones || {};
  var eStores = (entrada && entrada.stores) || {};
  var eTombs = (entrada && entrada.tombstones) || {};

  var tombs = {};
  var claves = {};
  Object.keys(mStores).forEach(function (k) { claves[k] = 1; });
  Object.keys(eStores).forEach(function (k) { claves[k] = 1; });
  Object.keys(mTombs).forEach(function (k) { claves[k] = 1; });
  Object.keys(eTombs).forEach(function (k) { claves[k] = 1; });

  var stores = {};
  Object.keys(claves).forEach(function (k) {
    var sv = mStores[k];
    var cv = eStores[k];
    var t = fusionarTombstones(mTombs[k], eTombs[k]);
    if (Object.keys(t).length) tombs[k] = t;
    var svArr = Array.isArray(sv);
    var cvArr = Array.isArray(cv);
    if (svArr || cvArr) {
      stores[k] = fusionarArreglo(svArr ? sv : [], cvArr ? cv : [], t);
    } else if (cv !== undefined) {
      stores[k] = cv;            // escalar/objeto: el cliente trae el valor
    } else if (sv !== undefined) {
      stores[k] = sv;
    }
  });

  return {
    version: (Number(master.version) || 0) + 1,
    actualizado: new Date().toISOString(),
    stores: stores,
    tombstones: tombs
  };
}

module.exports = { claveDeRegistro, fusionarArreglo, fusionarTombstones, fusionarMaestro };
