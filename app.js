/* ============================================================
   NEXUSMED · Plataforma Clínica (prototipo)
   Módulos: Admisión · Registro Médico · Configuraciones
   Datos locales (localStorage). Sin dependencias externas.
   ============================================================ */
'use strict';

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);
const store = {
  get(k, def){ try{ return JSON.parse(localStorage.getItem('nxm_'+k)) ?? def; }catch(e){ return def; } },
  set(k, v){ localStorage.setItem('nxm_'+k, JSON.stringify(v)); }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
function fmtFecha(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  if(isNaN(d)) return iso;
  return d.toLocaleString('es-CO',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}
/* crea celda segura (texto, nunca HTML) */
function td(text, cls){ const c=document.createElement('td'); if(cls)c.className=cls; c.textContent=(text==null||text==='')?'—':String(text); return c; }
/* ISO -> valor de <input datetime-local> (hora local) y viceversa */
function isoToLocalInput(iso){ const d=iso?new Date(iso):new Date(); if(isNaN(d)) return ''; const t=new Date(d.getTime()-d.getTimezoneOffset()*60000); return t.toISOString().slice(0,16); }
function localInputToIso(val){ if(!val) return new Date().toISOString(); const d=new Date(val); return isNaN(d)?new Date().toISOString():d.toISOString(); }
function flash(el, texto, tipo){ el.textContent=texto; el.className='msg'+(tipo?(' '+tipo):''); if(texto){ setTimeout(()=>{ if(el.textContent===texto){el.textContent='';el.className='msg';} }, 4000); } }

/* ============================================================
   AUTENTICACIÓN Y PERMISOS
   ============================================================ */
const ROLES = { maestro:'Maestro', admin:'Administrador', medico:'Médico', administrativo:'Administrativo' };
const ESPECIALIDADES = ['General','Fisioterapeuta','Fonoaudiólogo','Terapeuta Ocupacional','Terapeuta Respiratorio','Psicólogo','Medicina Interna','Pediatría','Ginecología','Urología','Cirugía General','Ortopedia','Auxiliar de Enfermería','Enfermería Jefe'];
const MODS = ['admision','registro','consulta','config'];
function defaultPerms(rol){
  switch(rol){
    case 'maestro': return {admision:true, registro:true, consulta:true, config:true, editar:true, eliminar:true};
    case 'admin':   return {admision:true, registro:true, consulta:true, config:false, editar:true, eliminar:true};
    case 'medico':  return {admision:false, registro:true, consulta:true, config:false, editar:false, eliminar:false};
    case 'administrativo': return {admision:true, registro:false, consulta:true, config:false, editar:false, eliminar:false};
    default: return {admision:false, registro:false, consulta:false, config:false, editar:false, eliminar:false};
  }
}
function bytesToHex(b){ return Array.from(b).map(x=>x.toString(16).padStart(2,'0')).join(''); }
function hexToBytes(h){ const a=new Uint8Array(h.length/2); for(let i=0;i<a.length;i++) a[i]=parseInt(h.substr(i*2,2),16); return a; }
/* hash de contraseña con PBKDF2 (Web Crypto); respaldo si no está disponible */
async function hashPwd(pwd, saltHex){
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  try{
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations:150000, hash:'SHA-256'}, key, 256);
    return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
  }catch(e){
    let h=0; const s=bytesToHex(salt)+pwd; for(let i=0;i<s.length;i++){ h=(h*31 + s.charCodeAt(i))>>>0; }
    return { salt: bytesToHex(salt), hash: 'w'+h.toString(16) };
  }
}
function usuarios(){ return store.get('usuarios', []); }
function setUsuarios(l){ store.set('usuarios', l); }
function necesitaMaestro(){ const l=usuarios(); return l.length===0 || !l.some(u=>u.rol==='maestro' && u.hash); }
function sesionUser(){ const s=store.get('sesion',null); if(!s) return null; const u=usuarios().find(x=>x.usuario===s.usuario); return (u && u.activo && u.hash)?u:null; }
let CURRENT = null;
function can(mod){ if(CURRENT && CURRENT.rol==='maestro') return true; return !!(CURRENT && CURRENT.perms && CURRENT.perms[mod]); }
/* el maestro SIEMPRE tiene todos los permisos; a los demás se les completan las llaves faltantes
   conservando lo que el maestro ya les concedió */
function permsCompletos(rol, base){
  const d = defaultPerms(rol);
  const out = Object.assign({}, d, base||{});
  if(rol==='maestro'){ Object.keys(d).forEach(k=> out[k]=true); }
  return out;
}
function repararPerms(){
  const l=usuarios(); let ch=false;
  l.forEach(u=>{ const nuevo=permsCompletos(u.rol, u.perms); if(JSON.stringify(nuevo)!==JSON.stringify(u.perms||{})){ u.perms=nuevo; ch=true; } });
  if(ch) setUsuarios(l);
}

async function doLogin(usuario, clave){
  const u = usuarios().find(x=>x.usuario===usuario.toLowerCase());
  if(!u || !u.hash) return 'Usuario o contraseña incorrectos.';
  if(!u.activo) return 'Este usuario está desactivado.';
  const chk = await hashPwd(clave, u.salt);
  if(chk.hash !== u.hash) return 'Usuario o contraseña incorrectos.';
  const l=usuarios(); const t=l.find(x=>x.usuario===u.usuario); t.ultimo=new Date().toISOString(); setUsuarios(l);
  store.set('sesion', {usuario:u.usuario, ts:Date.now()});
  entrar(t); return null;
}
function entrar(u){
  CURRENT = u;
  $('gate').hidden = true;
  $('userName').textContent = u.usuario;
  $('userRole').textContent = (ROLES[u.rol]||u.rol).toUpperCase();
  aplicarPermisos();
  renderAdm(); loadIps(); refreshPacList(); regMostrarTipos();
  if(can('config')){ renderUsr(); renderUsrList(); }
  goView('home');
}
function salir(){ store.set('sesion', null); CURRENT=null; mostrarGate(); }
function aplicarPermisos(){
  document.querySelectorAll('.modcard').forEach(c=>{ c.style.display = can(c.getAttribute('data-view')) ? '' : 'none'; });
}
function mostrarGate(){
  const alta = necesitaMaestro();
  $('gAlta').hidden = !alta; $('gLogin').hidden = alta;
  $('msgLogin').textContent=''; $('msgAlta').textContent='';
  $('gate').hidden = false;
}
$('formLogin').addEventListener('submit', async (e)=>{ e.preventDefault();
  const err = await doLogin($('inUsuario').value.trim(), $('inClave').value);
  if(err) flash($('msgLogin'), err, 'err'); else $('inClave').value='';
});
$('btnVer').addEventListener('click', ()=>{ const i=$('inClave'); i.type = i.type==='password'?'text':'password'; });
$('formAlta').addEventListener('submit', async (e)=>{ e.preventDefault();
  const usuario=$('altaUsuario').value.trim().toLowerCase(), c1=$('altaClave').value, c2=$('altaClave2').value;
  if(!/^[a-z0-9._-]{3,}$/.test(usuario)){ flash($('msgAlta'),'Usuario inválido (letras, números, punto, guion).','err'); return; }
  if(c1.length<8 || !/[a-z]/i.test(c1) || !/[0-9]/.test(c1)){ flash($('msgAlta'),'La contraseña debe tener 8+ caracteres con letras y números.','err'); return; }
  if(c1!==c2){ flash($('msgAlta'),'Las contraseñas no coinciden.','err'); return; }
  const h = await hashPwd(c1);
  const maestro = { id:uid(), usuario, rol:'maestro', activo:true, ultimo:new Date().toISOString(), salt:h.salt, hash:h.hash, perms:defaultPerms('maestro') };
  setUsuarios([maestro]); store.set('sesion', {usuario, ts:Date.now()}); entrar(maestro);
});
$('btnSalir').addEventListener('click', salir);

/* ---------- navegación entre vistas ---------- */
const VIEW_PERM = { admision:'admision', registro:'registro', consulta:'consulta', config:'config' };
function goView(name){
  if(VIEW_PERM[name] && !can(VIEW_PERM[name])){ alert('No tienes permiso para acceder a este módulo.'); return; }
  if(name==='registro') regMostrarTipos();
  document.querySelectorAll('.view').forEach(v=> v.classList.toggle('sel', v.id===name));
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('[data-view]').forEach(el=>{
  el.addEventListener('click', ()=> goView(el.getAttribute('data-view')));
});

/* ============================================================
   MÓDULO 1 · ADMISIÓN
   ============================================================ */
function nombrePaciente(a){ return [a.n1,a.n2,a.a1,a.a2].filter(Boolean).join(' '); }

function renderAdm(){
  const lista = store.get('admisiones', []);
  const tb = $('admTb'); tb.innerHTML='';
  $('admCount').textContent = lista.length + (lista.length===1?' registro':' registros');
  if(!lista.length){ const tr=document.createElement('tr'); const c=td('Sin admisiones registradas aún.'); c.colSpan=7; c.className='vacio'; tr.appendChild(c); tb.appendChild(tr); return; }
  lista.slice().reverse().forEach(a=>{
    const tr=document.createElement('tr');
    tr.appendChild(td(fmtFecha(a.fecha)));
    tr.appendChild(td(nombrePaciente(a)));
    tr.appendChild(td((a.tipoDoc||'')+' '+(a.doc||'')));
    tr.appendChild(td(a.ingreso));
    tr.appendChild(td(a.eps));
    tr.appendChild(td(a.medico));
    const acc=document.createElement('td'); acc.className='right';
    if(can('editar')){
      const be=document.createElement('button'); be.className='btn ghost mini'; be.textContent='Editar'; be.style.marginRight='6px';
      be.addEventListener('click', ()=> cargarAdm(a.id));
      acc.appendChild(be);
    }
    const bd=document.createElement('button'); bd.className='btn del mini'; bd.textContent='Eliminar';
    bd.addEventListener('click', ()=>{ if(confirm('¿Eliminar esta admisión?')){ const l=store.get('admisiones',[]).filter(x=>x.id!==a.id); store.set('admisiones',l); if(editAdmId===a.id) cancelarEdicionAdm(); renderAdm(); refreshPacList(); } });
    acc.appendChild(bd); tr.appendChild(acc);
    tb.appendChild(tr);
  });
}

let editAdmId = null;
$('formAdm').addEventListener('submit', (e)=>{
  e.preventDefault();
  const doc=$('admDoc').value.trim(), n1=$('admN1').value.trim(), a1=$('admA1').value.trim();
  [['admDoc',doc],['admN1',n1],['admA1',a1]].forEach(([id,v])=> $(id).classList.toggle('bad', !v));
  if(!doc||!n1||!a1){ flash($('admMsg'),'Completa documento, primer nombre y primer apellido.','err'); return; }
  if(editAdmId){
    if(!can('editar')){ flash($('admMsg'),'No tienes permiso para editar admisiones.','err'); return; }
    const l=store.get('admisiones',[]); const r=l.find(x=>x.id===editAdmId);
    if(!r){ cancelarEdicionAdm(); flash($('admMsg'),'La admisión ya no existe.','err'); renderAdm(); return; }
    Object.assign(r, { tipoDoc:$('admTipoDoc').value, doc, n1, n2:$('admN2').value.trim(), a1, a2:$('admA2').value.trim(),
      nac:$('admNac').value, sexo:$('admSexo').value, tel:$('admTel').value.trim(), dir:$('admDir').value.trim(),
      eps:$('admEps').value.trim(), regimen:$('admReg').value, ingreso:$('admIng').value,
      fecha:$('admFecha').value || r.fecha, dx:$('admDx').value.trim(), medico:$('admMed').value.trim(),
      obs:$('admObs').value.trim(), editadoPor:(CURRENT&&CURRENT.usuario)||'', editadoEl:new Date().toISOString() });
    store.set('admisiones',l);
    flash($('admMsg'),'Admisión actualizada correctamente.','ok');
    cancelarEdicionAdm(); renderAdm(); refreshPacList(); return;
  }
  const reg={ id:uid(), tipoDoc:$('admTipoDoc').value, doc, n1, n2:$('admN2').value.trim(), a1, a2:$('admA2').value.trim(),
    nac:$('admNac').value, sexo:$('admSexo').value, tel:$('admTel').value.trim(), dir:$('admDir').value.trim(),
    eps:$('admEps').value.trim(), regimen:$('admReg').value, ingreso:$('admIng').value,
    fecha:$('admFecha').value || new Date().toISOString(), dx:$('admDx').value.trim(), medico:$('admMed').value.trim(),
    obs:$('admObs').value.trim() };
  const l=store.get('admisiones',[]); l.push(reg); store.set('admisiones',l);
  flash($('admMsg'),'Admisión guardada correctamente.','ok');
  limpiarAdm(true); renderAdm(); refreshPacList();
});
function cargarAdm(id){
  const a=store.get('admisiones',[]).find(x=>x.id===id); if(!a) return;
  $('admTipoDoc').value=a.tipoDoc||'CC'; $('admDoc').value=a.doc||''; $('admN1').value=a.n1||''; $('admN2').value=a.n2||'';
  $('admA1').value=a.a1||''; $('admA2').value=a.a2||''; $('admNac').value=a.nac||''; $('admSexo').value=a.sexo||'';
  $('admTel').value=a.tel||''; $('admDir').value=a.dir||''; $('admEps').value=a.eps||''; $('admReg').value=a.regimen||'Contributivo';
  $('admIng').value=a.ingreso||'Urgencias'; $('admFecha').value=(a.fecha||'').slice(0,16); $('admDx').value=a.dx||'';
  $('admMed').value=a.medico||''; $('admObs').value=a.obs||'';
  editAdmId=id; $('admGuardar').textContent='Actualizar admisión';
  $('admLimpiar').textContent='Cancelar edición';
  flash($('admMsg'),'Editando una admisión existente. Guarda para aplicar los cambios.','ok');
  window.scrollTo({top:0,behavior:'smooth'});
}
function cancelarEdicionAdm(){
  editAdmId=null; $('admGuardar').textContent='Guardar admisión'; $('admLimpiar').textContent='Limpiar';
}
function limpiarAdm(keepFecha){
  ['admDoc','admN1','admN2','admA1','admA2','admNac','admTel','admDir','admEps','admDx','admMed','admObs'].forEach(id=>{ $(id).value=''; $(id).classList.remove('bad'); });
  if(!keepFecha){ $('admFecha').value=''; }
}
$('admLimpiar').addEventListener('click', ()=>{ limpiarAdm(false); cancelarEdicionAdm(); flash($('admMsg'),''); });

/* ============================================================
   MÓDULO 2 · REGISTRO MÉDICO (flujo simple por tipo + paciente)
   ============================================================ */
let regTipo = null;          /* tipo de nota elegido */
let regPac  = null;          /* {nombre, doc} paciente resuelto */
let editNotaId = null;       /* id de la nota en edición (modal) */

/* índice de pacientes a partir de admisiones (y notas previas) */
function indicePacientes(){
  const map=new Map();
  store.get('admisiones',[]).forEach(a=>{ const doc=(a.doc||'').trim(); const nom=nombrePaciente(a); if(doc && !map.has(doc)) map.set(doc,nom); });
  store.get('notas',[]).forEach(n=>{ const doc=(n.doc||'').trim(); if(doc && !map.has(doc)) map.set(doc,n.pac||''); });
  return map;
}
/* llena el datalist con "Nombre (documento)" */
function refreshPacList(){
  const dl=$('pacFull'); if(!dl) return; dl.innerHTML='';
  indicePacientes().forEach((nom,doc)=>{ const o=document.createElement('option'); o.value=(nom?nom+' ':'')+'('+doc+')'; dl.appendChild(o); });
}
/* vuelve al listado de tipos */
function regMostrarTipos(){
  regTipo=null; regPac=null;
  $('regTipos').hidden=false; $('regPanel').hidden=true;
}
/* abre el panel de un tipo concreto */
function regAbrirTipo(tipo){
  regTipo=tipo; regPac=null;
  $('regTipoTit').textContent=tipo;
  $('regBuscar').value=''; $('regPacNom').value=''; $('regPacDoc').value='';
  $('regNueva').disabled=true; flash($('regMsg'),'');
  $('regTipos').hidden=true; $('regPanel').hidden=false;
  refreshPacList(); renderReg();
  setTimeout(()=>$('regBuscar').focus(),50);
}
$('regTipoList').addEventListener('click', (e)=>{ const b=e.target.closest('[data-tipo]'); if(b) regAbrirTipo(b.getAttribute('data-tipo')); });
$('regVolver').addEventListener('click', regMostrarTipos);

/* resuelve el texto de búsqueda a un paciente */
function resolverPaciente(txt){
  txt=(txt||'').trim(); if(!txt) return null;
  const idx=indicePacientes();
  const mParen=txt.match(/\(([^)]+)\)\s*$/);   /* "Nombre (documento)" */
  if(mParen){ const doc=mParen[1].trim(); if(idx.has(doc)) return {doc, nombre:idx.get(doc)}; }
  if(idx.has(txt)) return {doc:txt, nombre:idx.get(txt)};           /* documento exacto */
  const low=txt.toLowerCase();
  for(const [doc,nom] of idx){ if((nom||'').toLowerCase()===low) return {doc, nombre:nom}; }
  for(const [doc,nom] of idx){ if((nom||'').toLowerCase().includes(low) || doc.includes(txt)) return {doc, nombre:nom}; }
  return null;
}
function aplicarBusqueda(){
  const p=resolverPaciente($('regBuscar').value);
  if(p){ regPac=p; $('regPacNom').value=p.nombre||'—'; $('regPacDoc').value=p.doc; $('regNueva').disabled=false; flash($('regMsg'),''); }
  else { regPac=null; $('regPacNom').value=''; $('regPacDoc').value=''; $('regNueva').disabled=true; }
  renderReg();
}
$('regBuscar').addEventListener('change', aplicarBusqueda);
$('regBuscar').addEventListener('input', ()=>{ /* autocompleta al elegir del listado */ if(resolverPaciente($('regBuscar').value)) aplicarBusqueda(); });

function renderReg(){
  const tb=$('regTb'); if(!tb) return; tb.innerHTML='';
  let lista=[];
  if(regPac){ lista=store.get('notas',[]).filter(n=> (n.doc||'').trim()===regPac.doc && n.tipo===regTipo); }
  lista.sort((a,b)=> (b.fecha||'').localeCompare(a.fecha||''));
  $('regCount').textContent = lista.length + (lista.length===1?' registro':' registros');
  if(!regPac){ const tr=document.createElement('tr'); const c=td('Busque un paciente para ver sus notas.'); c.colSpan=5; c.className='vacio'; tr.appendChild(c); tb.appendChild(tr); return; }
  if(!lista.length){ const tr=document.createElement('tr'); const c=td('Este paciente aún no tiene notas de este tipo.'); c.colSpan=5; c.className='vacio'; tr.appendChild(c); tb.appendChild(tr); return; }
  lista.forEach(n=>{
    const tr=document.createElement('tr');
    tr.appendChild(td(fmtFecha(n.fecha)));
    const tt=document.createElement('td'); const p=document.createElement('span'); p.className='pill cy'; p.textContent=n.tipo; tt.appendChild(p); tr.appendChild(tt);
    tr.appendChild(td(n.medico));
    const ct=document.createElement('td'); ct.className='cellwrap'; ct.textContent=n.texto||'—'; tr.appendChild(ct);
    const acc=document.createElement('td'); acc.className='right';
    const be=document.createElement('button'); be.className='btn ghost mini'; be.textContent='Editar';
    be.addEventListener('click', ()=> abrirNota(n.id));
    acc.appendChild(be);
    if(n.tipo==='Historia clínica'){
      const bp=document.createElement('button'); bp.className='btn mini'; bp.textContent='PDF EPS'; bp.style.marginLeft='6px';
      bp.addEventListener('click', ()=> historiaClinicaPDF(n.id));
      acc.appendChild(bp);
    }
    if(can('eliminar')){
      const bd=document.createElement('button'); bd.className='btn del mini'; bd.textContent='Eliminar'; bd.style.marginLeft='6px';
      bd.addEventListener('click', ()=>{ if(confirm('¿Eliminar esta nota?')){ store.set('notas', store.get('notas',[]).filter(x=>x.id!==n.id)); renderReg(); } });
      acc.appendChild(bd);
    }
    tr.appendChild(acc); tb.appendChild(tr);
  });
}

/* ---- modal de nota (crear / editar) ---- */
/* campos del formulario estructurado de Historia Clínica */
const HC_FIELDS = ['hcMotivo','hcEnf','hcTA','hcFC','hcFR','hcT','hcSat','hcPeso','hcTalla','hcIMC',
  'hcDxNut','hcAntPer','hcAntFam','hcAlerg','hcQuir','hcGineco','hcExGen','hcExCab','hcExTorax',
  'hcExAbd','hcExGen2','hcExExt','hcExSNC','hcExPiel','hcDx','hcPlan','hcPara'];
const esHC = (tipo)=> tipo==='Historia clínica';
function hcToggle(tipo){
  const on=esHC(tipo);
  const hc=$('ntHC'), simple=$('ntSimpleBox');
  if(hc) hc.hidden=!on;
  if(simple) simple.hidden=on;
  const modal=$('ovNota')&&$('ovNota').querySelector('.modal');
  if(modal) modal.classList.toggle('hc', on);
}
function hcFill(hc){ hc=hc||{}; HC_FIELDS.forEach(id=>{ const el=$(id); if(el) el.value=hc[id]||''; }); }
function hcClear(){ HC_FIELDS.forEach(id=>{ const el=$(id); if(el) el.value=''; }); }
function hcCollect(){ const o={}; HC_FIELDS.forEach(id=>{ const el=$(id); o[id]=el?(el.value||'').trim():''; }); return o; }
function hcCalcIMC(){
  const p=parseFloat(($('hcPeso').value||'').replace(',','.'));
  const t=parseFloat(($('hcTalla').value||'').replace(',','.'));
  if(p>0 && t>0){ const m=t/100; const v=p/(m*m); $('hcIMC').value=isFinite(v)?v.toFixed(1):''; }
  else { $('hcIMC').value=''; }
}
/* resumen de texto para la lista (vista de tabla) a partir de la HC */
function hcResumen(hc){
  hc=hc||{};
  const dx=(hc.hcDx||'').split(/\n+/).filter(Boolean).join('; ');
  return [hc.hcMotivo?('Motivo: '+hc.hcMotivo):'', dx?('Dx: '+dx):''].filter(Boolean).join('  |  ') || '(historia clínica)';
}
(function(){
  ['hcPeso','hcTalla'].forEach(id=>{ const el=$(id); if(el) el.addEventListener('input', hcCalcIMC); });
})();

function abrirNota(id){
  editNotaId = id || null;
  flash($('ntMsg'),'');
  hcClear();
  if(editNotaId){
    const n=store.get('notas',[]).find(x=>x.id===editNotaId); if(!n){ return; }
    $('notaTit').textContent='Editar '+(n.tipo||'nota').toLowerCase();
    $('ntTipo').value=n.tipo; $('ntPac').value=n.pac||'—'; $('ntDoc').value=n.doc||'';
    $('ntMed').value=n.medico||''; $('ntTexto').value=n.texto||''; $('ntFecha').value=isoToLocalInput(n.fecha);
    hcToggle(n.tipo); if(esHC(n.tipo)) hcFill(n.hc);
    $('notaGuardar').textContent='Actualizar nota';
  } else {
    if(!regPac){ flash($('regMsg'),'Primero busque y seleccione un paciente.','err'); return; }
    $('notaTit').textContent='Nueva '+(regTipo||'nota').toLowerCase();
    $('ntTipo').value=regTipo; $('ntPac').value=regPac.nombre||'—'; $('ntDoc').value=regPac.doc;
    $('ntMed').value=(CURRENT&&(CURRENT.nombre||CURRENT.usuario))||''; $('ntTexto').value=''; $('ntFecha').value=isoToLocalInput();
    hcToggle(regTipo);
    $('notaGuardar').textContent='Guardar nota';
  }
  $('ovNota').hidden=false; setTimeout(()=>$('ntMed').focus(),50);
}
function cerrarNota(){ $('ovNota').hidden=true; editNotaId=null; }
$('regNueva').addEventListener('click', ()=> abrirNota());
$('notaX').addEventListener('click', cerrarNota);
$('notaCancel').addEventListener('click', cerrarNota);
$('ovNota').addEventListener('click', (e)=>{ if(e.target===$('ovNota')) cerrarNota(); });
$('formNota').addEventListener('submit', (e)=>{
  e.preventDefault();
  const tipo=$('ntTipo').value;
  let texto, hc=null;
  if(esHC(tipo)){
    hc=hcCollect();
    if(!hc.hcMotivo && !hc.hcEnf){ flash($('ntMsg'),'Escriba al menos el motivo o la enfermedad actual.','err'); return; }
    texto=hcResumen(hc);
  } else {
    texto=$('ntTexto').value.trim();
    if(!texto){ flash($('ntMsg'),'Escribe el contenido de la nota.','err'); return; }
  }
  if(editNotaId){
    const l=store.get('notas',[]); const n=l.find(x=>x.id===editNotaId);
    if(!n){ cerrarNota(); renderReg(); return; }
    n.medico=$('ntMed').value.trim(); n.texto=texto; n.fecha=localInputToIso($('ntFecha').value);
    if(esHC(tipo)) n.hc=hc; else delete n.hc;
    n.editadoPor=(CURRENT&&CURRENT.usuario)||''; n.editadoEl=new Date().toISOString();
    store.set('notas',l);
  } else {
    const prof=CURRENT||{};
    const nota={ id:uid(), fecha:localInputToIso($('ntFecha').value), creadoEl:new Date().toISOString(), tipo:tipo, pac:$('ntPac').value.trim(), doc:$('ntDoc').value.trim(), medico:$('ntMed').value.trim(), especialidad:prof.especialidad||'', registro:prof.registro||'', firma:prof.firma||'', texto, creadoPor:(CURRENT&&CURRENT.usuario)||'' };
    if(esHC(tipo)) nota.hc=hc;
    const l=store.get('notas',[]); l.push(nota); store.set('notas',l);
  }
  cerrarNota(); renderReg();
});

/* ============================================================
   MÓDULO · CONSULTA (búsqueda por documento + exportar PDF)
   ============================================================ */
let csResultados = [];
function fechaSoloDia(iso){ return (iso||'').slice(0,10); }
function consultaFiltrar(){
  const doc=$('csDoc').value.trim();
  const serv=$('csServ').value;
  const d1=$('csD1').value, d2=$('csD2').value;
  if(!doc){ flash($('csMsg'),'Indica el número de documento del paciente.','err'); return null; }
  let lista=store.get('notas',[]).filter(n=> (n.doc||'').trim()===doc);
  if(serv) lista=lista.filter(n=> n.tipo===serv);
  if(d1) lista=lista.filter(n=> fechaSoloDia(n.fecha) >= d1);
  if(d2) lista=lista.filter(n=> fechaSoloDia(n.fecha) <= d2);
  lista.sort((a,b)=> (a.fecha||'').localeCompare(b.fecha||''));
  return lista;
}
function renderConsulta(lista){
  csResultados = lista;
  const tb=$('csTb'); tb.innerHTML='';
  $('csCount').textContent = lista.length + (lista.length===1?' registro':' registros');
  $('csPdf').disabled = lista.length===0;
  const nombre = lista.length ? lista[0].pac : nombrePorDoc($('csDoc').value.trim());
  $('csPac').textContent = nombre ? ('Paciente: '+nombre+'  ·  Documento: '+$('csDoc').value.trim()) : '';
  if(!lista.length){ const tr=document.createElement('tr'); const c=td('No hay servicios para ese documento en el rango indicado.'); c.colSpan=5; c.className='vacio'; tr.appendChild(c); tb.appendChild(tr); return; }
  lista.forEach(n=>{
    const tr=document.createElement('tr');
    tr.appendChild(td(fmtFecha(n.fecha)));
    const tt=document.createElement('td'); const p=document.createElement('span'); p.className='pill cy'; p.textContent=n.tipo; tt.appendChild(p); tr.appendChild(tt);
    tr.appendChild(td(n.pac));
    tr.appendChild(td(n.medico));
    const ct=document.createElement('td'); ct.className='cellwrap'; ct.textContent=n.texto||'—'; tr.appendChild(ct);
    tb.appendChild(tr);
  });
}
function nombrePorDoc(doc){
  const a=store.get('admisiones',[]).find(x=>(x.doc||'').trim()===doc); if(a) return nombrePaciente(a);
  const n=store.get('notas',[]).find(x=>(x.doc||'').trim()===doc); return n?n.pac:'';
}
$('formCons').addEventListener('submit', (e)=>{ e.preventDefault(); const l=consultaFiltrar(); if(l){ flash($('csMsg'),''); renderConsulta(l); } });
$('csLimpiar').addEventListener('click', ()=>{ $('csDoc').value=''; $('csServ').value=''; $('csD1').value=''; $('csD2').value=''; renderConsulta([]); $('csPac').textContent=''; flash($('csMsg'),''); });
$('csServ').addEventListener('change', ()=>{ if($('csDoc').value.trim()){ const l=consultaFiltrar(); if(l) renderConsulta(l); } });
$('csPdf').addEventListener('click', consultaPDF);

function consultaPDF(){
  if(!csResultados.length){ flash($('csMsg'),'Primero realiza una consulta con resultados.','err'); return; }
  if(!(window.jspdf && window.jspdf.jsPDF)){ flash($('csMsg'),'No se pudo cargar el generador de PDF.','err'); return; }
  const { jsPDF } = window.jspdf;
  const d = new jsPDF({ unit:'pt', format:'a4' });
  const ml=48, mr=48, mt=56; const pw=d.internal.pageSize.getWidth(), ph=d.internal.pageSize.getHeight();
  const ancho = pw-ml-mr; let y=mt;
  const ips=store.get('ips',{});
  const doc=$('csDoc').value.trim();
  const nombre=csResultados[0].pac || nombrePorDoc(doc) || '—';
  const d1=$('csD1').value, d2=$('csD2').value, serv=$('csServ').value;
  function nl(h){ if(y+h > ph-48){ d.addPage(); y=mt; } }
  function linea(){ d.setDrawColor(0,200,248); d.setLineWidth(1); d.line(ml,y,pw-mr,y); y+=14; }
  // encabezado
  d.setFont('helvetica','bold'); d.setFontSize(16); d.setTextColor(11,22,34);
  d.text((ips.nombre||'NEXUSMED · IPS'), ml, y); y+=20;
  d.setFont('helvetica','normal'); d.setFontSize(9); d.setTextColor(90,105,120);
  const sub=[ips.nit?('NIT '+ips.nit):'', ips.hab?('Habilitación '+ips.hab):''].filter(Boolean).join('   ·   ');
  if(sub){ d.text(sub, ml, y); y+=14; }
  d.setFontSize(12); d.setTextColor(11,22,34); d.setFont('helvetica','bold');
  d.text('Reporte de servicios clínicos', ml, y); y+=16;
  d.setFont('helvetica','normal'); d.setFontSize(10); d.setTextColor(40,50,65);
  d.text('Paciente: '+nombre, ml, y); y+=14;
  d.text('Documento: '+doc, ml, y); y+=14;
  const rango = (d1||d2) ? ('Rango: '+(d1||'inicio')+' a '+(d2||'hoy')) : 'Rango: todas las fechas';
  d.text(rango+'   ·   Servicio: '+(serv||'Todos'), ml, y); y+=14;
  d.text('Generado: '+fmtFecha(new Date().toISOString())+'   ·   Total: '+csResultados.length+' registro(s)', ml, y); y+=10;
  linea();
  // registros
  csResultados.forEach((n,i)=>{
    nl(60);
    d.setFont('helvetica','bold'); d.setFontSize(11); d.setTextColor(0,120,160);
    d.text((i+1)+'. '+n.tipo, ml, y); y+=15;
    d.setFont('helvetica','normal'); d.setFontSize(9); d.setTextColor(90,105,120);
    d.text('Fecha: '+fmtFecha(n.fecha)+'      Profesional: '+(n.medico||'—'), ml, y); y+=15;
    const perfil=[n.especialidad?('Especialidad: '+n.especialidad):'', n.registro?('Registro: '+n.registro):''].filter(Boolean).join('      ');
    if(perfil){ d.text(perfil, ml, y); y+=15; }
    d.setFontSize(10); d.setTextColor(25,35,48);
    const txt = (n.texto&&n.texto.trim()) ? n.texto : '(sin contenido)';
    const lineas = d.splitTextToSize(txt, ancho);
    lineas.forEach(ln=>{ nl(14); d.text(ln, ml, y); y+=14; });
    // firma del profesional (si existe)
    if(n.firma && /^data:image\/(png|jpeg)/.test(n.firma)){
      try{
        const fmt = /^data:image\/png/.test(n.firma) ? 'PNG' : 'JPEG';
        let fw=130, fh=46;
        try{ const pr=d.getImageProperties(n.firma); if(pr&&pr.width&&pr.height){ fh=Math.min(50, fw*pr.height/pr.width); } }catch(_){}
        y+=6; nl(fh+16);
        d.setFont('helvetica','normal'); d.setFontSize(8); d.setTextColor(120,130,142); d.text('Firma:', ml, y); y+=4;
        d.addImage(n.firma, fmt, ml, y, fw, fh); y+=fh+4;
      }catch(_){ }
    }
    y+=8; nl(16); d.setDrawColor(210,220,230); d.setLineWidth(0.5); d.line(ml,y,pw-mr,y); y+=16;
  });
  // pie con numeración
  const tot=d.internal.getNumberOfPages();
  for(let p=1;p<=tot;p++){ d.setPage(p); d.setFontSize(8); d.setTextColor(150,160,172); d.text('NEXUSMED · documento generado localmente · página '+p+' de '+tot, ml, ph-28); }
  const safe=(nombre||'paciente').replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'').toLowerCase();
  d.save('consulta_'+(doc||'doc')+'_'+safe+'.pdf');
  flash($('csMsg'),'PDF generado.','ok');
}

/* obtiene la admisión (datos demográficos) de un paciente por documento */
function admisionPorDoc(doc){
  doc=(doc||'').trim();
  return store.get('admisiones',[]).find(x=>(x.doc||'').trim()===doc) || null;
}

/* ============================================================
   PDF HISTORIA CLÍNICA (formato para envío a la EPS)
   Reproduce la estructura estándar: encabezado IPS + datos del
   paciente + secciones + firma del profesional.
   ============================================================ */
function historiaClinicaPDF(id){
  const n=store.get('notas',[]).find(x=>x.id===id);
  if(!n){ return; }
  if(!(window.jspdf && window.jspdf.jsPDF)){ flash($('regMsg'),'No se pudo cargar el generador de PDF.','err'); return; }
  const { jsPDF } = window.jspdf;
  const d = new jsPDF({ unit:'pt', format:'a4' });
  const ml=42, mr=42, mt=46; const pw=d.internal.pageSize.getWidth(), ph=d.internal.pageSize.getHeight();
  const ancho = pw-ml-mr; let y=mt;
  const ips=store.get('ips',{});
  const a=admisionPorDoc(n.doc)||{};
  const hc=n.hc||{};
  const INK=[20,28,40], GRIS=[90,100,115], LINEA=[120,135,150];

  function nl(h){ if(y+h > ph-56){ d.addPage(); y=mt; } }
  /* banda de sección */
  function band(titulo){
    nl(26); y+=4;
    d.setFillColor(11,22,34); d.setDrawColor(11,22,34);
    d.rect(ml, y-11, ancho, 17, 'F');
    d.setFont('helvetica','bold'); d.setFontSize(9.5); d.setTextColor(255,255,255);
    d.text(titulo.toUpperCase(), ml+6, y+1); y+=16;
    d.setTextColor(INK[0],INK[1],INK[2]);
  }
  /* campo etiqueta + valor (multilínea) */
  function campo(label, valor, indentLabel){
    valor=(valor==null||valor==='')?'—':String(valor);
    d.setFont('helvetica','bold'); d.setFontSize(9); d.setTextColor(60,72,88);
    const lab=(label?label+': ':'');
    const labW=d.getTextWidth(lab);
    d.setFont('helvetica','normal'); d.setTextColor(INK[0],INK[1],INK[2]);
    const lineas=d.splitTextToSize(valor, ancho-labW-10);
    nl(lineas.length*12+4);
    if(lab){ d.setFont('helvetica','bold'); d.setTextColor(60,72,88); d.text(lab, ml+4, y); }
    d.setFont('helvetica','normal'); d.setTextColor(INK[0],INK[1],INK[2]);
    lineas.forEach((ln,i)=>{ d.text(ln, ml+4+(i===0?labW:0), y); y+=12; });
    y+=2;
  }

  /* ---------- encabezado ---------- */
  d.setFont('helvetica','bold'); d.setFontSize(15); d.setTextColor(11,22,34);
  d.text((ips.nombre||'NEXUSMED · IPS'), ml, y); y+=16;
  d.setFont('helvetica','normal'); d.setFontSize(8.5); d.setTextColor(GRIS[0],GRIS[1],GRIS[2]);
  const sub=[ips.nit?('NIT '+ips.nit):'', ips.hab?('Habilitación '+ips.hab):''].filter(Boolean).join('     ·     ');
  if(sub){ d.text(sub, ml, y); y+=12; }
  d.setDrawColor(LINEA[0],LINEA[1],LINEA[2]); d.setLineWidth(0.8); d.line(ml,y,pw-mr,y); y+=4;
  d.setFont('helvetica','bold'); d.setFontSize(11.5); d.setTextColor(11,22,34);
  d.text('HISTORIA CLÍNICA – CONSULTA EXTERNA', pw/2, y+12, {align:'center'}); y+=22;

  /* ---------- datos del paciente (recuadro) ---------- */
  const nombre=n.pac || nombrePaciente(a) || '—';
  const sexo=a.sexo||'—'; const nac=a.nac? a.nac : '—';
  const tipoDoc=a.tipoDoc?(a.tipoDoc+' '):'';
  const boxTop=y;
  y+=12;
  const colL=ml+6, colR=ml+ancho/2+4;
  function par(xl, label, val){
    d.setFont('helvetica','bold'); d.setFontSize(8.5); d.setTextColor(60,72,88);
    d.text(label+': ', xl, y);
    const w=d.getTextWidth(label+': ');
    d.setFont('helvetica','normal'); d.setTextColor(INK[0],INK[1],INK[2]);
    d.text(String(val||'—'), xl+w, y);
  }
  par(colL,'Paciente',nombre); par(colR,'Documento',tipoDoc+(n.doc||'')); y+=13;
  par(colL,'Sexo',sexo); par(colR,'Fecha nac.',nac); y+=13;
  par(colL,'Dirección',a.dir||'—'); par(colR,'Teléfono',a.tel||'—'); y+=13;
  par(colL,'EPS / Aseguradora',a.eps||'—'); par(colR,'Régimen',a.regimen||'—'); y+=13;
  par(colL,'Fecha de atención',fmtFecha(n.fecha)); par(colR,'Profesional',n.medico||'—'); y+=6;
  d.setDrawColor(LINEA[0],LINEA[1],LINEA[2]); d.setLineWidth(0.8);
  d.rect(ml, boxTop, ancho, y-boxTop);
  y+=8;

  /* ---------- secciones ---------- */
  band('Motivo de la consulta');
  campo('', hc.hcMotivo);

  band('Enfermedad actual');
  campo('', hc.hcEnf);

  band('Revisión por sistemas · Signos vitales');
  const vit=[['TA',hc.hcTA,'mmHg'],['FC',hc.hcFC,'lpm'],['FR',hc.hcFR,'rpm'],['Temp',hc.hcT,'°C'],
             ['SatO2',hc.hcSat,'%'],['Peso',hc.hcPeso,'kg'],['Talla',hc.hcTalla,'cm'],['IMC',hc.hcIMC,'']];
  const vitTxt=vit.filter(v=>v[1]).map(v=> v[0]+': '+v[1]+(v[2]?(' '+v[2]):'')).join('     ');
  campo('', vitTxt || '—');
  if(hc.hcDxNut) campo('Dx nutricional', hc.hcDxNut);

  band('Antecedentes');
  campo('Personales', hc.hcAntPer);
  campo('Familiares', hc.hcAntFam);
  campo('Alergias', hc.hcAlerg);
  campo('Quirúrgicos', hc.hcQuir);
  if(hc.hcGineco) campo('Gineco-obstétricos', hc.hcGineco);

  band('Examen físico');
  campo('Estado general y conciencia', hc.hcExGen);
  campo('Cabeza, cara y cuello', hc.hcExCab);
  campo('Tórax', hc.hcExTorax);
  campo('Abdomen', hc.hcExAbd);
  if(hc.hcExGen2) campo('Genitales', hc.hcExGen2);
  campo('Extremidades', hc.hcExExt);
  campo('Sistema nervioso central', hc.hcExSNC);
  campo('Piel y faneras', hc.hcExPiel);

  band('Diagnóstico');
  (hc.hcDx||'').split(/\n+/).filter(Boolean).forEach((dx,i)=> campo('', (i+1)+'. '+dx));
  if(!(hc.hcDx||'').trim()) campo('', '—');

  band('Plan');
  campo('', hc.hcPlan);

  if((hc.hcPara||'').trim()){ band('Paraclínicos'); campo('', hc.hcPara); }

  /* ---------- firma del profesional ---------- */
  nl(80); y+=18;
  const fx=ml+4;
  if(n.firma && /^data:image\/(png|jpeg)/.test(n.firma)){
    try{
      const fmt=/^data:image\/png/.test(n.firma)?'PNG':'JPEG';
      let fw=150, fh=52;
      try{ const pr=d.getImageProperties(n.firma); if(pr&&pr.width&&pr.height){ fh=Math.min(56, fw*pr.height/pr.width); } }catch(_){}
      d.addImage(n.firma, fmt, fx, y-fh, fw, fh);
    }catch(_){ }
  }
  d.setDrawColor(INK[0],INK[1],INK[2]); d.setLineWidth(0.8); d.line(fx, y, fx+200, y); y+=12;
  d.setFont('helvetica','bold'); d.setFontSize(9.5); d.setTextColor(INK[0],INK[1],INK[2]);
  d.text((n.medico||'—'), fx, y); y+=12;
  d.setFont('helvetica','normal'); d.setFontSize(8.5); d.setTextColor(GRIS[0],GRIS[1],GRIS[2]);
  if(n.especialidad){ d.text(n.especialidad, fx, y); y+=11; }
  if(n.registro){ d.text('Registro médico: '+n.registro, fx, y); y+=11; }

  /* ---------- pie con numeración ---------- */
  const tot=d.internal.getNumberOfPages();
  for(let p=1;p<=tot;p++){
    d.setPage(p); d.setFontSize(7.5); d.setTextColor(150,160,172);
    d.text((ips.nombre||'NEXUSMED')+' · Historia clínica · página '+p+' de '+tot, ml, ph-26);
    d.text('Documento generado el '+fmtFecha(new Date().toISOString()), pw-mr, ph-26, {align:'right'});
  }
  const safe=(nombre||'paciente').replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'').toLowerCase();
  d.save('historia_clinica_'+(n.doc||'doc')+'_'+safe+'.pdf');
  flash($('regMsg'),'Historia clínica en PDF generada.','ok');
}

/* ============================================================
   MÓDULO 3 · CONFIGURACIONES (parámetros IPS + usuarios)
   ============================================================ */
/* -- parámetros de la IPS -- */
function loadIps(){ const p=store.get('ips',{}); $('ipsNombre').value=p.nombre||''; $('ipsNit').value=p.nit||''; $('ipsHab').value=p.hab||''; }
$('formIps').addEventListener('submit', (e)=>{
  e.preventDefault();
  store.set('ips',{ nombre:$('ipsNombre').value.trim(), nit:$('ipsNit').value.trim(), hab:$('ipsHab').value.trim() });
  flash($('ipsMsg'),'Parámetros guardados.','ok');
});
/* -- usuarios y permisos (solo el maestro ve esta vista) -- */
function renderUsr(){
  const lista=usuarios();
  const tb=$('usrTb'); tb.innerHTML='';
  lista.forEach(u=>{
    const tr=document.createElement('tr');
    tr.appendChild(td(u.usuario));
    const rc=document.createElement('td'); const rp=document.createElement('span'); rp.className='pill '+((u.rol==='maestro'||u.rol==='admin')?'cy':'gr'); rp.textContent=ROLES[u.rol]||u.rol; rc.appendChild(rp); tr.appendChild(rc);
    MODS.forEach(m=>{
      const c=document.createElement('td'); c.className='csw';
      const lab=document.createElement('label'); lab.className='sw';
      const inp=document.createElement('input'); inp.type='checkbox'; inp.checked=(u.rol==='maestro')?true:!!(u.perms&&u.perms[m]);
      if(u.rol==='maestro') inp.disabled=true; /* el maestro conserva todos los permisos */
      inp.addEventListener('change', ()=>{ const l=usuarios(); const t=l.find(x=>x.id===u.id); if(!t) return; if(!t.perms) t.perms={}; t.perms[m]=inp.checked; setUsuarios(l); });
      const tk=document.createElement('span'); tk.className='track';
      lab.appendChild(inp); lab.appendChild(tk); c.appendChild(lab); tr.appendChild(c);
    });
    /* columna Editar admisiones (permiso independiente) */
    const ce=document.createElement('td'); ce.className='csw';
    const le=document.createElement('label'); le.className='sw';
    const ie=document.createElement('input'); ie.type='checkbox'; ie.checked=(u.rol==='maestro')?true:!!(u.perms&&u.perms.editar);
    if(u.rol==='maestro') ie.disabled=true;
    ie.addEventListener('change', ()=>{ const l=usuarios(); const t=l.find(x=>x.id===u.id); if(!t) return; if(!t.perms) t.perms={}; t.perms.editar=ie.checked; setUsuarios(l); });
    const tke=document.createElement('span'); tke.className='track';
    le.appendChild(ie); le.appendChild(tke); ce.appendChild(le);
    /* columna Eliminar notas clínicas (permiso independiente) */
    const cx=document.createElement('td'); cx.className='csw';
    const lx=document.createElement('label'); lx.className='sw';
    const ix=document.createElement('input'); ix.type='checkbox'; ix.checked=(u.rol==='maestro')?true:!!(u.perms&&u.perms.eliminar);
    if(u.rol==='maestro') ix.disabled=true;
    ix.addEventListener('change', ()=>{ const l=usuarios(); const t=l.find(x=>x.id===u.id); if(!t) return; if(!t.perms) t.perms={}; t.perms.eliminar=ix.checked; setUsuarios(l); });
    const tkx=document.createElement('span'); tkx.className='track';
    lx.appendChild(ix); lx.appendChild(tkx); cx.appendChild(lx);
    tr.appendChild(ce); tr.appendChild(cx);
    tb.appendChild(tr);
  });
}
/* lista de gestión de usuarios (estado / último acceso / acciones) */
function renderUsrList(){
  const lista=usuarios();
  const tb=$('usrListTb'); if(!tb) return; tb.innerHTML='';
  const cnt=$('usrCount'); if(cnt) cnt.textContent = lista.length + (lista.length===1?' usuario':' usuarios');
  lista.forEach(u=>{
    const tr=document.createElement('tr');
    tr.appendChild(td(u.usuario));
    tr.appendChild(td(u.nombre||''));
    tr.appendChild(td(u.especialidad||''));
    const rc=document.createElement('td'); const rp=document.createElement('span'); rp.className='pill '+((u.rol==='maestro'||u.rol==='admin')?'cy':'gr'); rp.textContent=ROLES[u.rol]||u.rol; rc.appendChild(rp); tr.appendChild(rc);
    const ec=document.createElement('td'); const ep=document.createElement('span'); ep.className='pill '+(u.activo?'ok':'off'); ep.textContent=u.activo?'Activo':'Inactivo'; ec.appendChild(ep); tr.appendChild(ec);
    tr.appendChild(td(u.ultimo?fmtFecha(u.ultimo):'Nunca'));
    const acc=document.createElement('td'); acc.className='right';
    if(u.rol==='maestro'){
      const b=document.createElement('span'); b.className='pill gr'; b.textContent='Tú (maestro)'; acc.appendChild(b);
    } else {
      const bt=document.createElement('button'); bt.className='btn ghost mini'; bt.textContent=u.activo?'Desactivar':'Activar';
      bt.addEventListener('click', ()=>{ const l=usuarios(); const t=l.find(x=>x.id===u.id); if(t){t.activo=!t.activo; setUsuarios(l); renderUsrList();} });
      const bd=document.createElement('button'); bd.className='btn del mini'; bd.textContent='Eliminar'; bd.style.marginLeft='6px';
      bd.addEventListener('click', ()=>{ if(confirm('¿Eliminar el usuario '+u.usuario+'?')){ setUsuarios(usuarios().filter(x=>x.id!==u.id)); renderUsr(); renderUsrList(); } });
      acc.appendChild(bt); acc.appendChild(bd);
    }
    tr.appendChild(acc); tb.appendChild(tr);
  });
}
/* navegación por apartados dentro de Configuraciones */
function cfgTab(name){
  document.querySelectorAll('.cfgtab').forEach(b=>b.classList.toggle('active', b.getAttribute('data-cfg')===name));
  document.querySelectorAll('.cfgpane').forEach(p=>{ p.hidden = (p.id!=='cfg-'+name); });
  if(name==='respaldo' && typeof bkRefrescar==='function') bkRefrescar();
}
(function(){
  const nav=$('cfgNav');
  if(nav) nav.addEventListener('click', (e)=>{ const b=e.target.closest('[data-cfg]'); if(b) cfgTab(b.getAttribute('data-cfg')); });
})();

/* ============================================================
   RESPALDO · Exportar / Importar (traslado manual entre equipos)
   No es sincronización ni servidor: genera/lee un archivo JSON.
   ============================================================ */
const BK_CLAVES = ['usuarios','admisiones','notas','ips'];

function bkInfoTexto(){
  const u=store.get('usuarios',[]).length;
  const a=store.get('admisiones',[]).length;
  const n=store.get('notas',[]).length;
  return 'En este dispositivo hay '+u+' usuario(s), '+a+' admisión(es) y '+n+' registro(s) médico(s).';
}
function bkRefrescar(){ const el=$('bkInfo'); if(el) el.textContent=bkInfoTexto(); }

function exportarRespaldo(){
  const datos={};
  BK_CLAVES.forEach(k=>{ datos[k]=store.get(k, Array.isArray(store.get(k,null))?[]:null); });
  const paquete={ app:'NEXUSMED', tipo:'respaldo', version:1, generadoEl:new Date().toISOString(), datos:datos };
  const texto=JSON.stringify(paquete, null, 2);
  const blob=new Blob([texto], {type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const sello=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  a.href=url; a.download='nexusmed-respaldo-'+sello+'.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
  flash($('bkMsg'),'Respaldo exportado. Envíe el archivo al otro equipo e impórtelo allá.','ok');
}

function importarRespaldo(texto){
  let paquete;
  try{ paquete=JSON.parse(texto); }catch(e){ flash($('bkMsg'),'El archivo no es un respaldo válido.','err'); return; }
  if(!paquete || paquete.tipo!=='respaldo' || !paquete.datos){ flash($('bkMsg'),'El archivo no corresponde a un respaldo de NEXUSMED.','err'); return; }
  const d=paquete.datos;
  const resumen='Se reemplazarán los datos de ESTE dispositivo por los del respaldo:\n\n'
    +'• Usuarios: '+((d.usuarios||[]).length)+'\n'
    +'• Admisiones: '+((d.admisiones||[]).length)+'\n'
    +'• Registros médicos: '+((d.notas||[]).length)+'\n\n'
    +'Esta acción no se puede deshacer. ¿Continuar?';
  if(!confirm(resumen)) return;
  BK_CLAVES.forEach(k=>{ if(d[k]!==undefined && d[k]!==null) store.set(k, d[k]); });
  flash($('bkMsg'),'Respaldo importado. La aplicación se recargará para aplicar los cambios.','ok');
  setTimeout(()=>location.reload(), 1200);
}

(function(){
  const bEx=$('btnExport'), bPick=$('btnImportPick'), file=$('fileImport');
  if(bEx) bEx.addEventListener('click', exportarRespaldo);
  if(bPick && file){
    bPick.addEventListener('click', ()=> file.click());
    file.addEventListener('change', ()=>{
      const f=file.files && file.files[0]; if(!f) return;
      const r=new FileReader();
      r.onload=()=>{ importarRespaldo(String(r.result||'')); file.value=''; };
      r.onerror=()=>{ flash($('bkMsg'),'No se pudo leer el archivo.','err'); file.value=''; };
      r.readAsText(f);
    });
  }
})();
/* -- poblar lista de especialidades y manejar la firma digital -- */
(function(){
  const sel=$('nuEspec');
  if(sel){ ESPECIALIDADES.forEach(e=>{ const o=document.createElement('option'); o.value=e; o.textContent=e; sel.appendChild(o); }); }
})();
let nuFirmaData = null; /* dataURL de la firma cargada */
(function(){
  const file=$('nuFirmaFile'), prev=$('nuFirmaPrev'), quit=$('nuFirmaQuitar');
  if(!file) return;
  file.addEventListener('change', ()=>{
    const f=file.files && file.files[0];
    if(!f){ nuFirmaData=null; prev.hidden=true; prev.removeAttribute('src'); return; }
    if(!/^image\/(png|jpeg)$/.test(f.type)){ flash($('usrMsg'),'La firma debe ser una imagen PNG o JPG.','err'); file.value=''; return; }
    if(f.size>600*1024){ flash($('usrMsg'),'La imagen de la firma es muy grande (máx. 600 KB).','err'); file.value=''; return; }
    const r=new FileReader();
    r.onload=()=>{ nuFirmaData=r.result; prev.src=r.result; prev.hidden=false; };
    r.readAsDataURL(f);
  });
  quit.addEventListener('click', ()=>{ nuFirmaData=null; file.value=''; prev.hidden=true; prev.removeAttribute('src'); });
})();
$('formUsr').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const usuario=$('nuUsuario').value.trim().toLowerCase(), clave=$('nuClave').value, rol=$('nuRol').value;
  const nombre=$('nuNombre').value.trim(), docn=$('nuDoc').value.trim(), registro=$('nuRegistro').value.trim(), especialidad=$('nuEspec').value;
  if(!/^[a-z0-9._-]{3,}$/.test(usuario)){ flash($('usrMsg'),'Usuario inválido (letras, números, punto, guion).','err'); return; }
  if(clave.length<8 || !/[a-z]/i.test(clave) || !/[0-9]/.test(clave)){ flash($('usrMsg'),'La contraseña debe tener 8+ caracteres con letras y números.','err'); return; }
  if(usuarios().some(x=>x.usuario===usuario)){ flash($('usrMsg'),'Ese usuario ya existe.','err'); return; }
  const h = await hashPwd(clave);
  const nuevo = { id:uid(), usuario, nombre, doc:docn, registro, especialidad, firma:nuFirmaData||'', rol, activo:true, ultimo:null, salt:h.salt, hash:h.hash, perms:defaultPerms(rol) };
  const l=usuarios(); l.push(nuevo); setUsuarios(l);
  $('nuUsuario').value=''; $('nuClave').value=''; $('nuNombre').value=''; $('nuDoc').value=''; $('nuRegistro').value=''; $('nuEspec').selectedIndex=0;
  nuFirmaData=null; $('nuFirmaFile').value=''; $('nuFirmaPrev').hidden=true; $('nuFirmaPrev').removeAttribute('src');
  flash($('usrMsg'),'Usuario creado con permisos de '+(ROLES[rol]||rol)+'.','ok'); renderUsr(); renderUsrList();
});

/* ---------- arranque ---------- */
function init(){
  const now = new Date(); now.setMinutes(now.getMinutes()-now.getTimezoneOffset());
  $('admFecha').value = now.toISOString().slice(0,16);
  repararPerms();
  const u = sesionUser();
  if(u){ entrar(u); } else { mostrarGate(); }
}
init();
