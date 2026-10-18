/* Unión de varios PDF en uno solo, 100 % dentro del navegador.
   No usa librerías externas ni internet: lee cada PDF, toma sus páginas
   y escribe un PDF nuevo con todas ellas en el orden indicado.
   Los archivos originales del usuario nunca se modifican. */
(function(root){
"use strict";

/* ================================================================
 *  1) Descompresión Flate (zlib / deflate) en JavaScript puro
 * ================================================================ */
function inflateRaw(src){
  var pos = 0, bb = 0, bc = 0;
  var out = new Uint8Array(1 << 16), on = 0;

  function ensure(extra){
    if(on + extra <= out.length) return;
    var l = out.length;
    while(l < on + extra) l *= 2;
    var nb = new Uint8Array(l);
    nb.set(out.subarray(0, on));
    out = nb;
  }
  function bits(n){
    if(n === 0) return 0;
    while(bc < n){
      if(pos >= src.length) throw new Error("flujo comprimido incompleto");
      bb = (bb | (src[pos++] << bc)) >>> 0;
      bc += 8;
    }
    var v = bb & ((1 << n) - 1);
    bb = bb >>> n; bc -= n;
    return v;
  }
  function tabla(lens, n){
    var counts = new Int32Array(16), i;
    for(i = 0; i < n; i++) counts[lens[i]]++;
    counts[0] = 0;
    var offs = new Int32Array(16), sum = 0;
    for(i = 1; i < 16; i++){ offs[i] = sum; sum += counts[i]; }
    var symbols = new Int32Array(sum);
    for(i = 0; i < n; i++) if(lens[i]) symbols[offs[lens[i]]++] = i;
    return { c:counts, s:symbols };
  }
  function decodeSym(h){
    var code = 0, first = 0, index = 0, len;
    for(len = 1; len < 16; len++){
      code |= bits(1);
      var count = h.c[len];
      if(code - first < count) return h.s[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error("código comprimido inválido");
  }

  var LB = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LE = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DB = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DE = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

  var fijoLit = null, fijoDist = null;
  function fijas(){
    if(fijoLit) return;
    var l = new Uint8Array(288), i;
    for(i = 0;   i < 144; i++) l[i] = 8;
    for(i = 144; i < 256; i++) l[i] = 9;
    for(i = 256; i < 280; i++) l[i] = 7;
    for(i = 280; i < 288; i++) l[i] = 8;
    fijoLit = tabla(l, 288);
    var d = new Uint8Array(30);
    for(i = 0; i < 30; i++) d[i] = 5;
    fijoDist = tabla(d, 30);
  }

  var ORDEN = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
  var fin = false;

  while(!fin){
    fin = bits(1) === 1;
    var tipo = bits(2);
    if(tipo === 0){
      bb = 0; bc = 0;
      if(pos + 4 > src.length) throw new Error("bloque sin comprimir incompleto");
      var len = src[pos] | (src[pos+1] << 8);
      pos += 4;
      if(pos + len > src.length) throw new Error("bloque sin comprimir incompleto");
      ensure(len);
      out.set(src.subarray(pos, pos + len), on);
      on += len; pos += len;
      continue;
    }
    var lit, dist;
    if(tipo === 1){
      fijas(); lit = fijoLit; dist = fijoDist;
    } else if(tipo === 2){
      var nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      var lens = new Uint8Array(320), i2;
      for(i2 = 0; i2 < ncode; i2++) lens[ORDEN[i2]] = bits(3);
      var hcl = tabla(lens, 19);
      var todos = new Uint8Array(nlen + ndist), k = 0;
      while(k < nlen + ndist){
        var sym = decodeSym(hcl), rep, val = 0;
        if(sym < 16){ todos[k++] = sym; continue; }
        if(sym === 16){
          if(k === 0) throw new Error("tabla comprimida inválida");
          val = todos[k-1]; rep = 3 + bits(2);
        } else if(sym === 17){ rep = 3 + bits(3); }
        else { rep = 11 + bits(7); }
        while(rep-- > 0 && k < nlen + ndist) todos[k++] = val;
      }
      lit  = tabla(todos.subarray(0, nlen), nlen);
      dist = tabla(todos.subarray(nlen, nlen + ndist), ndist);
    } else {
      throw new Error("bloque comprimido no válido");
    }
    for(;;){
      var s = decodeSym(lit);
      if(s === 256) break;
      if(s < 256){ ensure(1); out[on++] = s; continue; }
      s -= 257;
      if(s >= LB.length) throw new Error("longitud comprimida inválida");
      var largo = LB[s] + bits(LE[s]);
      var ds = decodeSym(dist);
      if(ds >= DB.length) throw new Error("distancia comprimida inválida");
      var d2 = DB[ds] + bits(DE[ds]);
      if(d2 > on) throw new Error("distancia comprimida fuera de rango");
      ensure(largo);
      var from = on - d2;
      for(var j = 0; j < largo; j++) out[on + j] = out[from + j];
      on += largo;
    }
  }
  return out.subarray(0, on);
}

function inflate(data){
  if(data.length > 1){
    var cmf = data[0], flg = data[1];
    if((cmf & 0x0f) === 8 && ((cmf << 8) + flg) % 31 === 0){
      try { return inflateRaw(data.subarray(2)); } catch(e){ /* probar en crudo */ }
    }
  }
  return inflateRaw(data);
}

/* ================================================================
 *  2) Utilidades de bytes
 * ================================================================ */
function u8(x){
  if(x instanceof Uint8Array) return x;
  if(x && x.buffer) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return new Uint8Array(x);
}
function txt(bytes, from, to){
  var s = "", b = bytes.subarray(from, to), paso = 8192;
  for(var i = 0; i < b.length; i += paso){
    s += String.fromCharCode.apply(null, b.subarray(i, Math.min(i + paso, b.length)));
  }
  return s;
}
function bytesDe(str){
  var b = new Uint8Array(str.length);
  for(var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xFF;
  return b;
}
function buscar(buf, pat, desde){
  var p = bytesDe(pat), n = buf.length - p.length;
  for(var i = Math.max(0, desde); i <= n; i++){
    var ok = true;
    for(var j = 0; j < p.length; j++){ if(buf[i+j] !== p[j]){ ok = false; break; } }
    if(ok) return i;
  }
  return -1;
}
function buscarAtras(buf, pat, desde){
  var p = bytesDe(pat);
  for(var i = Math.min(desde, buf.length - p.length); i >= 0; i--){
    var ok = true;
    for(var j = 0; j < p.length; j++){ if(buf[i+j] !== p[j]){ ok = false; break; } }
    if(ok) return i;
  }
  return -1;
}
function esBlanco(c){ return c===0x20||c===0x0a||c===0x0d||c===0x09||c===0x0c||c===0x00; }
function esDelim(c){ return c===0x28||c===0x29||c===0x3c||c===0x3e||c===0x5b||c===0x5d||c===0x7b||c===0x7d||c===0x2f||c===0x25; }
function esReg(c){ return !esBlanco(c) && !esDelim(c); }

function esNombre(v, n){ return v && v.n !== undefined && (n === undefined || v.n === n); }
function esRef(v){ return v && v.r !== undefined && v.n === undefined; }
function esStream(v){ return !!(v && v.isStream); }
function dicDe(v){ return esStream(v) ? v.sd : (v instanceof Map ? v : null); }

/* ================================================================
 *  3) Lectura de un documento PDF
 * ================================================================ */
function PdfDoc(buf){
  this.buf = u8(buf);
  this.pos = 0;
  this.xref = new Map();      // nº objeto -> {off} | {stm, idx}
  this.cache = new Map();
  this.trailer = new Map();
  this.escaneado = false;
  this.objstm = {};           // nº de object stream ya cargados
}

/* ---- lectura de tokens ---- */
PdfDoc.prototype.saltar = function(){
  var b = this.buf;
  for(;;){
    while(this.pos < b.length && esBlanco(b[this.pos])) this.pos++;
    if(this.pos < b.length && b[this.pos] === 0x25){          // comentario %
      while(this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      continue;
    }
    return;
  }
};
PdfDoc.prototype.palabra = function(){
  this.saltar();
  var b = this.buf, ini = this.pos;
  while(this.pos < b.length && esReg(b[this.pos])) this.pos++;
  if(this.pos === ini && this.pos < b.length) this.pos++;
  return txt(b, ini, this.pos);
};
PdfDoc.prototype.entero = function(){
  var t = this.palabra(), n = parseInt(t, 10);
  if(isNaN(n)) throw new Error("se esperaba un número y se encontró \"" + t.slice(0,12) + "\"");
  return n;
};

PdfDoc.prototype.valor = function(){
  this.saltar();
  var b = this.buf;
  if(this.pos >= b.length) throw new Error("fin de archivo inesperado");
  var c = b[this.pos];

  if(c === 0x2f){                                   // nombre /Algo
    this.pos++;
    var s = "";
    while(this.pos < b.length && esReg(b[this.pos])){
      var ch = b[this.pos++];
      if(ch === 0x23 && this.pos + 1 < b.length){
        var h = parseInt(txt(b, this.pos, this.pos + 2), 16);
        if(!isNaN(h)){ s += String.fromCharCode(h); this.pos += 2; continue; }
      }
      s += String.fromCharCode(ch);
    }
    return { n:s };
  }
  if(c === 0x28) return this.cadena();
  if(c === 0x3c){
    if(b[this.pos+1] === 0x3c) return this.diccionario();
    return this.hex();
  }
  if(c === 0x5b){                                   // array
    this.pos++;
    var arr = [];
    for(;;){
      this.saltar();
      if(this.pos >= b.length) throw new Error("array sin cerrar");
      if(b[this.pos] === 0x5d){ this.pos++; return arr; }
      arr.push(this.valor());
    }
  }
  if(c === 0x5d || c === 0x3e || c === 0x29){ this.pos++; return null; }

  var ini = this.pos, t = this.palabra();
  if(t === "true")  return true;
  if(t === "false") return false;
  if(t === "null")  return null;
  if(/^[+-]?[\d.]+$/.test(t)){
    var num = parseFloat(t);
    if(isNaN(num)) num = 0;
    if(/^\d+$/.test(t)){                             // ¿referencia "12 0 R"?
      var g = this.pos;
      try{
        this.saltar();
        var t2ini = this.pos, t2 = this.palabra();
        if(/^\d+$/.test(t2)){
          this.saltar();
          var t3 = this.palabra();
          if(t3 === "R") return { r:num, g:parseInt(t2,10) };
        }
        this.pos = g;
        void t2ini;
      }catch(e){ this.pos = g; }
    }
    return num;
  }
  if(t === ""){ this.pos = ini + 1; return null; }
  return { n:t, raro:true };                         // palabra suelta: se ignora
};

PdfDoc.prototype.cadena = function(){
  var b = this.buf, out = [], nivel = 0;
  this.pos++;
  for(;;){
    if(this.pos >= b.length) break;
    var c = b[this.pos++];
    if(c === 0x5c){                                   // \
      if(this.pos >= b.length) break;
      var e = b[this.pos++];
      if(e === 0x6e) out.push(10);
      else if(e === 0x72) out.push(13);
      else if(e === 0x74) out.push(9);
      else if(e === 0x62) out.push(8);
      else if(e === 0x66) out.push(12);
      else if(e >= 0x30 && e <= 0x37){
        var o = e - 0x30, k = 0;
        while(k < 2 && this.pos < b.length && b[this.pos] >= 0x30 && b[this.pos] <= 0x37){
          o = o * 8 + (b[this.pos++] - 0x30); k++;
        }
        out.push(o & 0xFF);
      }
      else if(e === 0x0a){ /* continuación de línea */ }
      else if(e === 0x0d){ if(b[this.pos] === 0x0a) this.pos++; }
      else out.push(e);
      continue;
    }
    if(c === 0x28){ nivel++; out.push(c); continue; }
    if(c === 0x29){
      if(nivel === 0) break;
      nivel--; out.push(c); continue;
    }
    out.push(c);
  }
  return { s:new Uint8Array(out) };
};
PdfDoc.prototype.hex = function(){
  var b = this.buf, h = "";
  this.pos++;
  while(this.pos < b.length && b[this.pos] !== 0x3e){
    var c = b[this.pos++];
    if(/[0-9a-fA-F]/.test(String.fromCharCode(c))) h += String.fromCharCode(c);
  }
  if(this.pos < b.length) this.pos++;
  if(h.length % 2) h += "0";
  var out = new Uint8Array(h.length / 2);
  for(var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i*2, 2), 16);
  return { s:out };
};
PdfDoc.prototype.diccionario = function(){
  var b = this.buf;
  this.pos += 2;
  var d = new Map();
  for(;;){
    this.saltar();
    if(this.pos >= b.length) throw new Error("diccionario sin cerrar");
    if(b[this.pos] === 0x3e && b[this.pos+1] === 0x3e){ this.pos += 2; break; }
    if(b[this.pos] !== 0x2f){                        // clave inesperada: se descarta
      var basura = this.valor();
      if(basura === null && this.pos >= b.length) throw new Error("diccionario sin cerrar");
      continue;
    }
    var clave = this.valor();
    var val = this.valor();
    if(clave && clave.n !== undefined) d.set(clave.n, val);
  }
  // ¿viene un stream?
  var guarda = this.pos;
  this.saltar();
  if(txt(b, this.pos, this.pos + 6) === "stream"){
    this.pos += 6;
    if(b[this.pos] === 0x0d) this.pos++;
    if(b[this.pos] === 0x0a) this.pos++;
    var ini = this.pos, largo = -1;
    try{
      var L = this.resolver(d.get("Length"));
      if(typeof L === "number" && L >= 0 && ini + L <= b.length) largo = L;
    }catch(e){ largo = -1; }
    var fin;
    if(largo >= 0){
      fin = ini + largo;
      var cola = txt(b, fin, fin + 20);
      if(!/^[\s]*endstream/.test(cola)) largo = -1;
    }
    if(largo < 0){
      var e2 = buscar(b, "endstream", ini);
      if(e2 < 0) throw new Error("stream sin cerrar");
      fin = e2;
      while(fin > ini && (b[fin-1] === 0x0a || b[fin-1] === 0x0d)) fin--;
    }
    var raw = b.subarray(ini, fin);
    var e3 = buscar(b, "endstream", fin);
    this.pos = e3 < 0 ? fin : e3 + 9;
    return { isStream:true, sd:d, raw:raw };
  }
  this.pos = guarda;
  return d;
};

/* ---- resolución de referencias ---- */
PdfDoc.prototype.resolver = function(v){
  var vueltas = 0;
  while(esRef(v)){
    if(++vueltas > 32) return null;
    v = this.obj(v.r);
  }
  return v;
};
PdfDoc.prototype.obj = function(num){
  var guarda = this.pos;
  try { return this._obj(num); }
  finally { this.pos = guarda; }
};
PdfDoc.prototype._obj = function(num){
  if(this.cache.has(num)) return this.cache.get(num);
  var ent = this.xref.get(num);
  if(!ent){
    this.escanear();
    ent = this.xref.get(num);
    if(!ent){ this.cache.set(num, null); return null; }
  }
  var val = null;
  try{
    if(ent.off !== undefined) val = this.enOffset(ent.off, num);
    else { this.cargarObjStm(ent.stm); val = this.cache.has(num) ? this.cache.get(num) : null; }
  }catch(e){
    val = null;
  }
  if(val === null && !this.escaneado){
    this.escanear();
    var e2 = this.xref.get(num);
    if(e2 && e2.off !== undefined){
      try { val = this.enOffset(e2.off, num); } catch(e3){ val = null; }
    }
  }
  this.cache.set(num, val);
  return val;
};
PdfDoc.prototype.enOffset = function(off, num){
  if(off < 0 || off >= this.buf.length) return null;
  this.pos = off;
  var n = this.entero();
  this.entero();
  var kw = this.palabra();
  if(kw !== "obj") return null;
  if(num !== undefined && n !== num) return null;
  return this.valor();
};

/* ---- object streams ---- */
PdfDoc.prototype.cargarObjStm = function(stmNum){
  if(this.objstm[stmNum]) return;
  this.objstm[stmNum] = true;
  var st = this.obj(stmNum);
  if(!esStream(st)) return;
  var data = this.datos(st);
  var N = this.resolver(st.sd.get("N")) || 0;
  var First = this.resolver(st.sd.get("First")) || 0;
  var head = new PdfDoc(data.subarray(0, First));
  var pares = [];
  for(var i = 0; i < N; i++){
    try { pares.push([head.entero(), head.entero()]); } catch(e){ break; }
  }
  var cuerpo = new PdfDoc(data);
  for(var k = 0; k < pares.length; k++){
    var num = pares[k][0];
    if(this.cache.has(num) && this.cache.get(num) !== null) continue;
    try{
      cuerpo.pos = First + pares[k][1];
      this.cache.set(num, cuerpo.valor());
    }catch(e){ /* objeto ilegible: se ignora */ }
  }
};

/* ---- filtros de stream (solo para xref y object streams) ---- */
PdfDoc.prototype.datos = function(st){
  var data = st.raw;
  var f = this.resolver(st.sd.get("Filter"));
  var parms = this.resolver(st.sd.get("DecodeParms")) || this.resolver(st.sd.get("DP"));
  var filtros = f ? (Array.isArray(f) ? f : [f]) : [];
  var lista = Array.isArray(parms) ? parms : [parms];
  for(var i = 0; i < filtros.length; i++){
    var nom = esNombre(filtros[i]) ? filtros[i].n : "";
    if(nom === "FlateDecode" || nom === "Fl"){
      data = inflate(data);
    } else if(nom === "ASCIIHexDecode" || nom === "AHx"){
      var s = txt(data, 0, data.length).replace(/[^0-9a-fA-F>]/g, "");
      s = s.split(">")[0];
      if(s.length % 2) s += "0";
      var o = new Uint8Array(s.length/2);
      for(var j = 0; j < o.length; j++) o[j] = parseInt(s.substr(j*2,2),16);
      data = o;
    } else if(nom){
      throw new Error("filtro " + nom + " no soportado");
    }
    var pd = this.resolver(lista[i]);
    if(pd instanceof Map) data = this.prediccion(data, pd);
  }
  return data;
};
PdfDoc.prototype.prediccion = function(data, pd){
  var pred = this.resolver(pd.get("Predictor")) || 1;
  if(pred < 2) return data;
  var colors = this.resolver(pd.get("Colors")) || 1;
  var bpc    = this.resolver(pd.get("BitsPerComponent")) || 8;
  var cols   = this.resolver(pd.get("Columns")) || 1;
  var bpp    = Math.ceil(colors * bpc / 8);
  var fila   = Math.ceil(colors * bpc * cols / 8);
  if(pred === 2){
    if(bpc !== 8) return data;
    for(var r = 0; r + fila <= data.length; r += fila){
      for(var i = bpp; i < fila; i++) data[r+i] = (data[r+i] + data[r+i-bpp]) & 0xFF;
    }
    return data;
  }
  var filas = Math.floor(data.length / (fila + 1));
  var out = new Uint8Array(filas * fila);
  var prev = new Uint8Array(fila);
  for(var f = 0; f < filas; f++){
    var tipo = data[f * (fila + 1)];
    var src = data.subarray(f * (fila + 1) + 1, f * (fila + 1) + 1 + fila);
    var cur = out.subarray(f * fila, (f + 1) * fila);
    cur.set(src);
    for(var x = 0; x < fila; x++){
      var a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      if(tipo === 1) cur[x] = (cur[x] + a) & 0xFF;
      else if(tipo === 2) cur[x] = (cur[x] + b) & 0xFF;
      else if(tipo === 3) cur[x] = (cur[x] + ((a + b) >> 1)) & 0xFF;
      else if(tipo === 4){
        var p = a + b - c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
        cur[x] = (cur[x] + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 0xFF;
      }
    }
    prev = cur;
  }
  return out;
};

/* ---- tabla de referencias cruzadas ---- */
PdfDoc.prototype.init = function(){
  var b = this.buf;
  if(txt(b, 0, 5) !== "%PDF-"){
    var d = buscar(b, "%PDF-", 0);
    if(d > 0) this.buf = b = b.subarray(d);
  }
  var ok = false;
  try { ok = this.leerXref(); } catch(e){ ok = false; }
  if(!ok || !this.trailer.get("Root")) this.escanear();
  if(this.trailer.get("Encrypt")) throw new Error("está cifrado o protegido con contraseña");
  return this;
};
PdfDoc.prototype.leerXref = function(){
  var b = this.buf;
  var sx = buscarAtras(b, "startxref", b.length - 9);
  if(sx < 0) return false;
  this.pos = sx + 9;
  var off = this.entero();
  var vistos = {}, vueltas = 0, algo = false;
  while(off >= 0 && off < b.length && !vistos[off] && ++vueltas < 64){
    vistos[off] = true;
    this.pos = off;
    this.saltar();
    var siguiente = -1, hibrido = -1;
    if(txt(b, this.pos, this.pos + 4) === "xref"){
      this.pos += 4;
      for(;;){
        this.saltar();
        if(txt(b, this.pos, this.pos + 7) === "trailer"){
          this.pos += 7;
          var tr = this.valor();
          if(tr instanceof Map){
            tr.forEach(function(v,k){ if(!this.trailer.has(k)) this.trailer.set(k,v); }, this);
            if(typeof tr.get("Prev") === "number") siguiente = tr.get("Prev");
            if(typeof tr.get("XRefStm") === "number") hibrido = tr.get("XRefStm");
          }
          break;
        }
        var ini, cnt;
        try { ini = this.entero(); cnt = this.entero(); }
        catch(e){ break; }
        for(var i = 0; i < cnt; i++){
          this.saltar();
          var o1 = this.palabra(), g1 = this.palabra(), t1 = this.palabra();
          void g1;
          var num = ini + i;
          if(t1 === "n" && !this.xref.has(num)) this.xref.set(num, { off: parseInt(o1, 10) });
        }
        algo = true;
      }
      if(hibrido >= 0){
        try { this.xrefStream(hibrido); } catch(e){}
      }
    } else {
      var r = this.xrefStream(off);
      if(r === false) return algo;
      algo = true;
      siguiente = r;
    }
    off = siguiente;
  }
  return algo;
};
PdfDoc.prototype.xrefStream = function(off){
  this.pos = off;
  var n = this.entero();
  void n;
  this.entero();
  if(this.palabra() !== "obj") return false;
  var st = this.valor();
  if(!esStream(st)) return false;
  var d = st.sd, self = this;
  d.forEach(function(v,k){ if(!self.trailer.has(k)) self.trailer.set(k,v); });
  var data = this.datos(st);
  var W = (this.resolver(d.get("W")) || []).map(function(x){ return self.resolver(x) || 0; });
  if(W.length < 3) return false;
  var size = this.resolver(d.get("Size")) || 0;
  var idx = this.resolver(d.get("Index"));
  var secciones = [];
  if(Array.isArray(idx)){
    for(var i = 0; i + 1 < idx.length; i += 2) secciones.push([this.resolver(idx[i]) || 0, this.resolver(idx[i+1]) || 0]);
  } else secciones.push([0, size]);
  var ancho = W[0] + W[1] + W[2], p = 0;
  for(var s = 0; s < secciones.length; s++){
    var ini = secciones[s][0], cnt = secciones[s][1];
    for(var k = 0; k < cnt; k++){
      if(p + ancho > data.length) break;
      var f = [0,0,0];
      for(var c = 0; c < 3; c++){
        var v = 0;
        for(var j = 0; j < W[c]; j++) v = v * 256 + data[p++];
        f[c] = v;
      }
      var tipo = W[0] === 0 ? 1 : f[0];
      var num2 = ini + k;
      if(!this.xref.has(num2)){
        if(tipo === 1) this.xref.set(num2, { off:f[1] });
        else if(tipo === 2) this.xref.set(num2, { stm:f[1], idx:f[2] });
      }
    }
  }
  var prev = this.resolver(d.get("Prev"));
  return typeof prev === "number" ? prev : -1;
};

/* ---- rescate: recorrer el archivo buscando "N G obj" ---- */
PdfDoc.prototype.escanear = function(){
  if(this.escaneado) return;
  this.escaneado = true;
  var s = txt(this.buf, 0, this.buf.length);
  var re = /(\d+)[\s]+(\d+)[\s]+obj\b/g, m;
  var encontrados = [];
  while((m = re.exec(s)) !== null){
    var num = parseInt(m[1], 10);
    this.xref.set(num, { off:m.index });        // el último gana (actualizaciones)
    this.cache.delete(num);
    encontrados.push(num);
  }
  // trailer
  var t = s.lastIndexOf("trailer");
  while(t >= 0){
    try{
      this.pos = t + 7;
      var tr = this.valor();
      if(tr instanceof Map){
        var self = this;
        tr.forEach(function(v,k){ if(!self.trailer.has(k)) self.trailer.set(k,v); });
      }
    }catch(e){}
    if(this.trailer.get("Root")) break;
    t = s.lastIndexOf("trailer", t - 1);
  }
  // object streams y catálogo
  for(var i = 0; i < encontrados.length; i++){
    var o = null;
    try { o = this.obj(encontrados[i]); } catch(e){ o = null; }
    var d = dicDe(o);
    if(!d) continue;
    var tp = d.get("Type");
    if(esStream(o) && esNombre(tp, "ObjStm")){
      try { this.cargarObjStm(encontrados[i]); } catch(e){}
    } else if(esNombre(tp, "Catalog") && !this.trailer.get("Root")){
      this.trailer.set("Root", { r:encontrados[i], g:0 });
    } else if(esStream(o) && esNombre(tp, "XRef") && !this.trailer.get("Root")){
      if(d.get("Root")) this.trailer.set("Root", d.get("Root"));
    }
  }
};

/* ---- páginas ---- */
var HEREDA = ["Resources","MediaBox","CropBox","Rotate"];
PdfDoc.prototype.paginas = function(){
  var out = [], self = this;
  var root = this.resolver(this.trailer.get("Root"));
  var rd = dicDe(root);
  var raizPaginas = rd ? rd.get("Pages") : null;
  var vistos = {};

  function anda(ref, inh, prof){
    if(prof > 64 || out.length > 20000) return;
    var num = esRef(ref) ? ref.r : 0;
    if(num){
      if(vistos[num]) return;
      vistos[num] = true;
    }
    var nodo = self.resolver(ref);
    var d = dicDe(nodo);
    if(!d) return;
    var her = {};
    HEREDA.forEach(function(k){ her[k] = d.has(k) ? d.get(k) : inh[k]; });
    var kids = self.resolver(d.get("Kids"));
    var tipo = d.get("Type");
    if(Array.isArray(kids) && !esNombre(tipo, "Page")){
      for(var i = 0; i < kids.length; i++) anda(kids[i], her, prof + 1);
      return;
    }
    if(esNombre(tipo, "Page") || d.has("Contents") || d.has("MediaBox")){
      out.push({ num:num, dict:d, inh:inh });
    }
  }

  if(raizPaginas) anda(raizPaginas, {}, 0);

  if(!out.length){                                  // rescate: buscar objetos /Type /Page
    this.escanear();
    var nums = Array.from(this.xref.keys()).concat(Array.from(this.cache.keys()));
    nums.sort(function(a,b){ return a - b; });
    var hechos = {};
    for(var i = 0; i < nums.length; i++){
      var n = nums[i];
      if(hechos[n]) continue;
      hechos[n] = true;
      var o = null;
      try { o = this.obj(n); } catch(e){ o = null; }
      var d2 = dicDe(o);
      if(d2 && !esStream(o) && esNombre(d2.get("Type"), "Page")) out.push({ num:n, dict:d2, inh:{} });
    }
  }
  return out;
};

/* ================================================================
 *  4) Escritura del PDF resultante
 * ================================================================ */
function Writer(){
  this.objs = [];        // posición 0 -> objeto 1
  this.mapa = new Map(); // "doc:num" -> nuevo número
  this.cola = [];
  this.docId = 0;
}
Writer.prototype.reservar = function(){ this.objs.push(null); return this.objs.length; };
Writer.prototype.poner = function(num, val){ this.objs[num-1] = val; };
Writer.prototype.idDoc = function(doc){
  if(doc.__wid === undefined) doc.__wid = ++this.docId;
  return doc.__wid;
};
Writer.prototype.fijarPagina = function(doc, viejo, nuevo){
  if(viejo) this.mapa.set(this.idDoc(doc) + ":" + viejo, nuevo);
};
Writer.prototype.refNueva = function(doc, num){
  var k = this.idDoc(doc) + ":" + num;
  if(this.mapa.has(k)) return this.mapa.get(k);
  var n = this.reservar();
  this.mapa.set(k, n);
  this.cola.push({ doc:doc, viejo:num, nuevo:n });
  return n;
};
Writer.prototype.copiar = function(doc, v, prof){
  prof = prof || 0;
  if(prof > 200) return null;
  if(v === null || v === undefined) return null;
  if(typeof v === "number" || typeof v === "boolean") return v;
  if(Array.isArray(v)){
    var a = [];
    for(var i = 0; i < v.length; i++) a.push(this.copiar(doc, v[i], prof+1));
    return a;
  }
  if(esRef(v)) return { r:this.refNueva(doc, v.r) };
  if(esStream(v)){
    var sd = new Map(), self = this;
    v.sd.forEach(function(x,k){ if(k !== "Length") sd.set(k, self.copiar(doc, x, prof+1)); });
    sd.set("Length", v.raw.length);
    return { isStream:true, sd:sd, raw:v.raw };
  }
  if(v instanceof Map){
    var d = new Map(), me = this;
    v.forEach(function(x,k){ d.set(k, me.copiar(doc, x, prof+1)); });
    return d;
  }
  if(v.n !== undefined) return { n:v.n };
  if(v.s !== undefined) return { s:v.s };
  return null;
};
Writer.prototype.vaciar = function(){
  var tope = 0;
  while(this.cola.length){
    if(++tope > 400000) throw new Error("el documento tiene demasiados objetos");
    var it = this.cola.shift();
    var val = null;
    try { val = it.doc.obj(it.viejo); } catch(e){ val = null; }
    this.poner(it.nuevo, this.copiar(it.doc, val, 0));
  }
};

/* ---- serialización ---- */
function numTxt(v){
  if(!isFinite(v)) return "0";
  if(Math.floor(v) === v && Math.abs(v) < 1e15) return String(v);
  return v.toFixed(6).replace(/0+$/,"").replace(/\.$/,"");
}
function hex2(c){ return (c < 16 ? "0" : "") + c.toString(16); }
function nomTxt(n){
  var o = "/";
  for(var i = 0; i < n.length; i++){
    var c = n.charCodeAt(i) & 0xFF;
    if(c < 0x21 || c > 0x7e || esDelim(c) || c === 0x23) o += "#" + hex2(c);
    else o += String.fromCharCode(c);
  }
  return o;
}
function serie(v, chunks){
  function put(s){ chunks.push(bytesDe(s)); }
  if(v === null || v === undefined){ put("null"); return; }
  if(typeof v === "number"){ put(numTxt(v)); return; }
  if(typeof v === "boolean"){ put(v ? "true" : "false"); return; }
  if(Array.isArray(v)){
    put("[");
    for(var i = 0; i < v.length; i++){ put(" "); serie(v[i], chunks); }
    put(" ]");
    return;
  }
  if(esRef(v)){ put(v.r + " 0 R"); return; }
  if(esStream(v)){
    serie(v.sd, chunks);
    put("\nstream\n");
    chunks.push(v.raw);
    put("\nendstream");
    return;
  }
  if(v instanceof Map){
    put("<<");
    v.forEach(function(x,k){ put(" " + nomTxt(k) + " "); serie(x, chunks); });
    put(" >>");
    return;
  }
  if(v.n !== undefined){ put(nomTxt(v.n)); return; }
  if(v.s !== undefined){
    var h = "<";
    for(var j = 0; j < v.s.length; j++) h += hex2(v.s[j]);
    put(h + ">");
    return;
  }
  put("null");
}
Writer.prototype.construir = function(){
  var chunks = [], largo = 0, offs = [];
  function add(list){
    for(var i = 0; i < list.length; i++){ chunks.push(list[i]); largo += list[i].length; }
  }
  add([bytesDe("%PDF-1.7\n"), new Uint8Array([0x25,0xE2,0xE3,0xCF,0xD3,0x0A])]);
  for(var i = 0; i < this.objs.length; i++){
    offs.push(largo);
    var c = [bytesDe((i+1) + " 0 obj\n")];
    serie(this.objs[i], c);
    c.push(bytesDe("\nendobj\n"));
    add(c);
  }
  var xrefOff = largo;
  var t = "xref\n0 " + (this.objs.length + 1) + "\n0000000000 65535 f \n";
  for(var k = 0; k < offs.length; k++){
    var s = String(offs[k]);
    while(s.length < 10) s = "0" + s;
    t += s + " 00000 n \n";
  }
  var id = "";
  for(var z = 0; z < 16; z++) id += hex2(Math.floor(Math.random() * 256));
  t += "trailer\n<< /Size " + (this.objs.length + 1) +
       " /Root 1 0 R /ID [<" + id + "><" + id + ">] >>\nstartxref\n" + xrefOff + "\n%%EOF\n";
  add([bytesDe(t)]);
  var out = new Uint8Array(largo), p = 0;
  for(var q = 0; q < chunks.length; q++){ out.set(chunks[q], p); p += chunks[q].length; }
  return out;
};

/* ================================================================
 *  5) Función pública
 * ================================================================ */
function merge(lista, nombres){
  if(!lista || !lista.length) throw new Error("no hay archivos para unir");
  var w = new Writer();
  var CAT = w.reservar(), PAGES = w.reservar();
  var docs = [], i;

  for(i = 0; i < lista.length; i++){
    var etiqueta = (nombres && nombres[i]) ? "“" + nombres[i] + "”" : "archivo " + (i+1);
    var doc, pgs;
    try{
      doc = new PdfDoc(lista[i]).init();
      pgs = doc.paginas();
    }catch(e){
      throw new Error("El " + etiqueta + " no se pudo leer: " + (e.message || e) + ".");
    }
    if(!pgs.length) throw new Error("El " + etiqueta + " no contiene páginas legibles.");
    var refs = [];
    for(var p = 0; p < pgs.length; p++) refs.push(w.reservar());
    for(p = 0; p < pgs.length; p++) w.fijarPagina(doc, pgs[p].num, refs[p]);
    docs.push({ doc:doc, pgs:pgs, refs:refs, etiqueta:etiqueta });
  }

  var kids = [], total = 0;
  for(i = 0; i < docs.length; i++){
    var D = docs[i];
    for(var j = 0; j < D.pgs.length; j++){
      var pg = D.pgs[j], d = new Map();
      pg.dict.forEach(function(v,k){
        if(k === "Parent") return;
        d.set(k, w.copiar(D.doc, v, 0));
      });
      HEREDA.forEach(function(k){
        if(!d.has(k) && pg.inh[k] !== undefined && pg.inh[k] !== null){
          d.set(k, w.copiar(D.doc, pg.inh[k], 0));
        }
      });
      d.set("Type", { n:"Page" });
      d.set("Parent", { r:PAGES });
      if(!d.has("MediaBox")) d.set("MediaBox", [0,0,612,792]);
      w.poner(D.refs[j], d);
      kids.push({ r:D.refs[j] });
      total++;
    }
  }
  w.vaciar();

  var pagesDict = new Map();
  pagesDict.set("Type", { n:"Pages" });
  pagesDict.set("Kids", kids);
  pagesDict.set("Count", total);
  w.poner(PAGES, pagesDict);

  var cat = new Map();
  cat.set("Type", { n:"Catalog" });
  cat.set("Pages", { r:PAGES });
  w.poner(CAT, cat);

  return { bytes:w.construir(), paginas:total };
}

function contarPaginas(bytes){
  try { return new PdfDoc(bytes).init().paginas().length; }
  catch(e){ return 0; }
}

root.PDFMerge = { merge:merge, contarPaginas:contarPaginas };

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
