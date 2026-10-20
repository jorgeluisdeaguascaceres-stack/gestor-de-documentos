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
  set(k, v){ localStorage.setItem('nxm_'+k, JSON.stringify(v)); if(!store._silent && typeof window.cloudPush==='function'){ try{ window.cloudPush(k, v); }catch(e){} } },
  setSilent(k, v){ store._silent=true; try{ localStorage.setItem('nxm_'+k, JSON.stringify(v)); } finally { store._silent=false; } },
  _silent:false
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
const ROLES = { maestro:'Maestro', admin:'Administrador', medico:'Médico', auxiliar:'Auxiliar de enfermería', administrativo:'Administrativo' };
/* Tipos de nota del núcleo clínico. La clave es estable; la etiqueta coincide con los
   botones de index.html. El permiso de CREAR/EDITAR es por tipo; VER siempre se permite
   a quien tenga acceso al módulo Registro. */
const TIPOS_NOTA = [
  {key:'hc',   label:'Historia clínica',                               corto:'H. clínica'},
  {key:'enf',  label:'Evolución de enfermería',                        corto:'Enfermería'},
  {key:'psi',  label:'Evolución de psicología',                        corto:'Psicología'},
  {key:'tf',   label:'Evolución de terapia física',                     corto:'T. física'},
  {key:'fono', label:'Evolución de fonoaudiología',                     corto:'Fonoaud.'},
  {key:'so',   label:'Evolución de terapia de salud ocupacional',       corto:'T. ocup.'},
  {key:'cama', label:'Nota de servicio de cama',                        corto:'N. cama'},
  {key:'traq', label:'Limpieza y cuidado de la traqueotomía',           corto:'Traqueo.'}
];
const TIPO_KEY = {}; TIPOS_NOTA.forEach(t=> TIPO_KEY[t.label]=t.key);
/* construye un mapa {clave:valor} aplicando fn a cada tipo de nota */
function crearSet(fn){ const o={}; TIPOS_NOTA.forEach(t=> o[t.key]=fn(t.key)); return o; }
/* notas propias del personal de enfermería / auxiliar */
const TIPOS_ENFERMERIA = ['enf','cama','traq'];
const ESPECIALIDADES = ['General','Fisioterapeuta','Fonoaudiólogo','Terapeuta Ocupacional','Terapeuta Respiratorio','Psicólogo','Medicina Interna','Pediatría','Ginecología','Urología','Cirugía General','Ortopedia','Auxiliar de Enfermería','Enfermería Jefe'];
const MODS = ['admision','registro','consulta','config'];
function defaultPerms(rol){
  switch(rol){
    case 'maestro': return {admision:true, registro:true, consulta:true, config:true, editar:true, eliminar:true, crear:crearSet(()=>true)};
    case 'admin':   return {admision:true, registro:true, consulta:true, config:false, editar:true, eliminar:true, crear:crearSet(()=>true)};
    /* el médico crea todo MENOS las notas propias de enfermería/auxiliar */
    case 'medico':  return {admision:false, registro:true, consulta:true, config:false, editar:false, eliminar:false, crear:crearSet(k=> !TIPOS_ENFERMERIA.includes(k))};
    /* el auxiliar/enfermería SOLO crea sus notas; puede VER las demás */
    case 'auxiliar': return {admision:false, registro:true, consulta:true, config:false, editar:false, eliminar:false, crear:crearSet(k=> TIPOS_ENFERMERIA.includes(k))};
    case 'administrativo': return {admision:true, registro:false, consulta:true, config:false, editar:false, eliminar:false, crear:crearSet(()=>false)};
    default: return {admision:false, registro:false, consulta:false, config:false, editar:false, eliminar:false, crear:crearSet(()=>false)};
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
/* ¿el usuario actual puede CREAR o EDITAR una nota de este tipo? (VER siempre se permite) */
function puedeCrear(tipo){
  if(CURRENT && CURRENT.rol==='maestro') return true;
  const k = TIPO_KEY[tipo]; if(!k) return false;
  return !!(CURRENT && CURRENT.perms && CURRENT.perms.crear && CURRENT.perms.crear[k]);
}
/* el maestro SIEMPRE tiene todos los permisos; a los demás se les completan las llaves faltantes
   conservando lo que el maestro ya les concedió */
function permsCompletos(rol, base){
  const d = defaultPerms(rol);
  const out = Object.assign({}, d, base||{});
  /* fusión profunda del mapa de creación por tipo de nota */
  out.crear = Object.assign({}, d.crear, (base&&base.crear)||{});
  if(rol==='maestro'){ Object.keys(d).forEach(k=>{ if(k!=='crear') out[k]=true; }); TIPOS_NOTA.forEach(t=> out.crear[t.key]=true); }
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
  renderAdm(); loadIps(); refreshPacList(); regMostrarTipos(); refreshMedList();
  epsRefrescarDatalist();
  if(can('config')){ renderUsr(); renderCrear(); renderUsrList(); renderEps(); segInfo(); }
  goView('home');
}
function salir(){ store.set('sesion', null); CURRENT=null; mostrarGate(); }
function aplicarPermisos(){
  document.querySelectorAll('.modcard').forEach(c=>{ c.style.display = can(c.getAttribute('data-view')) ? '' : 'none'; });
}
function mostrarGate(){
  const alta = necesitaMaestro();
  $('gAlta').hidden = !alta; $('gLogin').hidden = alta;
  if($('gCambio')) $('gCambio').hidden = true;
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

/* ---------- cambiar contraseña desde el inicio (sin iniciar sesión) ---------- */
if($('btnIrCambio')){
  $('btnIrCambio').addEventListener('click', ()=>{
    $('gLogin').hidden=true; if($('gCambio')) $('gCambio').hidden=false;
    ['cbUsuario','cbActual','cbNueva','cbNueva2'].forEach(id=>{ if($(id)) $(id).value=''; });
    if($('msgCambio')) $('msgCambio').textContent='';
    if($('inUsuario') && $('cbUsuario')) $('cbUsuario').value=$('inUsuario').value.trim();
    if($('cbUsuario')) $('cbUsuario').focus();
  });
}
if($('btnVolverLogin')){
  $('btnVolverLogin').addEventListener('click', ()=>{ if($('gCambio')) $('gCambio').hidden=true; $('gLogin').hidden=false; $('msgLogin').textContent=''; });
}
if($('btnVerCb')){
  $('btnVerCb').addEventListener('click', ()=>{ const i=$('cbActual'); i.type = i.type==='password'?'text':'password'; });
}
if($('formCambio')){
  $('formCambio').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const usuario=$('cbUsuario').value.trim().toLowerCase();
    const act=$('cbActual').value, n1=$('cbNueva').value, n2=$('cbNueva2').value;
    if(!usuario){ flash($('msgCambio'),'Escriba su usuario.','err'); return; }
    const u=usuarios().find(x=>x.usuario===usuario);
    if(!u || !u.hash){ flash($('msgCambio'),'Usuario o contraseña actual incorrectos.','err'); return; }
    const chk=await hashPwd(act, u.salt);
    if(chk.hash!==u.hash){ flash($('msgCambio'),'Usuario o contraseña actual incorrectos.','err'); return; }
    if(n1.length<8 || !/[a-z]/i.test(n1) || !/[0-9]/.test(n1)){ flash($('msgCambio'),'La nueva contraseña debe tener 8+ caracteres con letras y números.','err'); return; }
    if(n1!==n2){ flash($('msgCambio'),'Las nuevas contraseñas no coinciden.','err'); return; }
    if(n1===act){ flash($('msgCambio'),'La nueva contraseña debe ser distinta a la actual.','err'); return; }
    const h=await hashPwd(n1);
    const l=usuarios(); const t=l.find(x=>x.id===u.id);
    if(!t){ flash($('msgCambio'),'No se encontró el usuario.','err'); return; }
    t.salt=h.salt; t.hash=h.hash; setUsuarios(l);
    if(CURRENT && CURRENT.id===t.id){ CURRENT.salt=t.salt; CURRENT.hash=t.hash; }
    ['cbActual','cbNueva','cbNueva2'].forEach(id=>{ $(id).value=''; });
    flash($('msgCambio'),'Contraseña actualizada. Ya puede iniciar sesión con la nueva.','ok');
    if($('inUsuario')) $('inUsuario').value=usuario;
    setTimeout(()=>{ if($('gCambio')) $('gCambio').hidden=true; $('gLogin').hidden=false; if($('inClave')) $('inClave').focus(); }, 1400);
  });
}

/* ---------- navegación entre vistas ---------- */
const VIEW_PERM = { admision:'admision', registro:'registro', consulta:'consulta', config:'config' };
function goView(name){
  if(VIEW_PERM[name] && !can(VIEW_PERM[name])){ alert('No tienes permiso para acceder a este módulo.'); return; }
  if(name==='registro') regMostrarTipos();
  if(name==='consulta') refreshMedList();
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
let soloLectura = false;     /* true cuando se abre una nota en modo ver (sin permiso de crear) */

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
  if(typeof actualizarBotonQuitarPac==='function') actualizarBotonQuitarPac();
  if(!puedeCrear(tipo)){ flash($('regMsg'),'Su perfil puede VER estas notas pero no crearlas ni editarlas (solo lectura).','warn'); }
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
  if(p){ regPac=p; $('regPacNom').value=p.nombre||'—'; $('regPacDoc').value=p.doc; $('regNueva').disabled=!puedeCrear(regTipo); flash($('regMsg'), puedeCrear(regTipo)?'':'Su perfil puede VER estas notas pero no crearlas ni editarlas (solo lectura).', puedeCrear(regTipo)?'':'warn'); }
  else { regPac=null; $('regPacNom').value=''; $('regPacDoc').value=''; $('regNueva').disabled=true; }
  actualizarBotonQuitarPac();
  renderReg();
}
/* el botón "Quitar paciente" solo se ve con un paciente seleccionado y permiso de eliminar */
function actualizarBotonQuitarPac(){
  const b=$('regQuitarPac'); if(!b) return;
  b.hidden = !(regPac && can('eliminar'));
}
function quitarPacienteActual(){
  if(!regPac){ return; }
  if(!can('eliminar')){ flash($('regMsg'),'No tienes permiso para eliminar.','err'); return; }
  const doc=regPac.doc;
  const nAdm=store.get('admisiones',[]).filter(x=>(x.doc||'').trim()===doc).length;
  const nNot=store.get('notas',[]).filter(x=>(x.doc||'').trim()===doc).length;
  const ok=confirm('¿Quitar al paciente con documento '+doc+'?\n\nSe eliminarán su admisión y TODAS sus notas de todos los tipos.\n\nAdmisiones: '+nAdm+'\nNotas: '+nNot+'\n\nEsta acción no se puede deshacer.');
  if(!ok) return;
  store.set('admisiones', store.get('admisiones',[]).filter(x=>(x.doc||'').trim()!==doc));
  store.set('notas', store.get('notas',[]).filter(x=>(x.doc||'').trim()!==doc));
  regPac=null; $('regBuscar').value=''; $('regPacNom').value=''; $('regPacDoc').value='';
  $('regNueva').disabled=true; actualizarBotonQuitarPac();
  refreshPacList(); renderReg(); renderAdm();
  flash($('regMsg'),'Paciente eliminado ('+(nAdm+nNot)+' registro(s)).','ok');
}
$('regBuscar').addEventListener('change', aplicarBusqueda);
$('regBuscar').addEventListener('input', ()=>{ /* autocompleta al elegir del listado */ if(resolverPaciente($('regBuscar').value)) aplicarBusqueda(); });
if($('regQuitarPac')) $('regQuitarPac').addEventListener('click', quitarPacienteActual);

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
    const puede=puedeCrear(n.tipo);
    let primero=true;
    const sep=(el)=>{ if(!primero) el.style.marginLeft='6px'; primero=false; acc.appendChild(el); };
    /* Editar: solo si el perfil puede crear/editar este tipo */
    if(puede){
      const be=document.createElement('button'); be.className='btn ghost mini'; be.textContent='Editar';
      be.addEventListener('click', ()=> abrirNota(n.id));
      sep(be);
    }
    /* Ver: SIEMPRE disponible (lectura). HC usa la vista previa; el resto, formulario de solo lectura */
    const bv=document.createElement('button'); bv.className='btn ghost mini'; bv.textContent='Ver';
    if(esHC(n.tipo)) bv.addEventListener('click', ()=> hcPreview(n.id));
    else bv.addEventListener('click', ()=> abrirNota(n.id, true));
    sep(bv);
    if(n.tipo==='Historia clínica'){
      const bp=document.createElement('button'); bp.className='btn mini'; bp.textContent='PDF EPS';
      bp.addEventListener('click', ()=> historiaClinicaPDF(n.id));
      sep(bp);
    }
    if(can('eliminar')){
      const bd=document.createElement('button'); bd.className='btn del mini'; bd.textContent='Eliminar';
      bd.addEventListener('click', ()=>{ if(confirm('¿Eliminar esta nota?')){ store.set('notas', store.get('notas',[]).filter(x=>x.id!==n.id)); renderReg(); } });
      sep(bd);
    }
    tr.appendChild(acc); tb.appendChild(tr);
  });
}

/* ---- modal de nota (crear / editar) ---- */
/* campos del formulario estructurado de Historia Clínica */
const HC_FIELDS = ['hcMotivo','hcEnf','hcTA','hcFC','hcFR','hcT','hcSat','hcPeso','hcTalla','hcIMC',
  'hcDxNut','hcAntPer','hcAntFam','hcAlerg','hcQuir','hcGineco','hcExGen','hcExCab','hcExTorax',
  'hcExAbd','hcExGen2','hcExExt','hcExSNC','hcExPiel','hcDx','hcPlan','hcPara','hcOrdenes','hcFormula'];
/* textos "normal" predeterminados del examen físico */
const HC_NORMALES = {
  hcExGen:'Paciente en buen estado general, consciente, orientado en las tres esferas, hidratado, afebril, con adecuada perfusión.',
  hcExCab:'Normocéfalo. Pupilas isocóricas reactivas a la luz. Conjuntivas normocrómicas. Fosas nasales permeables. Mucosa oral húmeda. Orofaringe sin alteraciones. Cuello móvil, sin adenomegalias ni ingurgitación yugular.',
  hcExTorax:'Tórax simétrico y expansible. Ruidos cardíacos rítmicos, sin soplos. Murmullo vesicular conservado en ambos campos pulmonares, sin agregados.',
  hcExAbd:'Abdomen blando, depresible, no doloroso a la palpación, sin masas ni megalias. Ruidos intestinales presentes y normales.',
  hcExGen2:'Genitales externos de aspecto normal para la edad y el sexo, sin lesiones.',
  hcExExt:'Extremidades simétricas, sin edema. Pulsos periféricos presentes y simétricos. Llenado capilar menor a 2 segundos. Movilidad conservada.',
  hcExSNC:'Paciente alerta, Glasgow 15/15, sin focalización neurológica. Fuerza y sensibilidad conservadas. Reflejos osteotendinosos normales.',
  hcExPiel:'Piel íntegra, hidratada, normocoloreada, sin lesiones. Faneras de aspecto normal.'
};
(function(){
  document.querySelectorAll('.normbtn').forEach(b=>{
    b.addEventListener('click', ()=>{ const id=b.getAttribute('data-norm'); const el=$(id); if(el && HC_NORMALES[id]){ el.value=HC_NORMALES[id]; } });
  });
  const all=$('hcNormAll');
  if(all) all.addEventListener('click', ()=>{ Object.keys(HC_NORMALES).forEach(id=>{ const el=$(id); if(el && !el.value.trim()) el.value=HC_NORMALES[id]; }); });
})();
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

function abrirNota(id, ro){
  editNotaId = id || null;
  soloLectura = !!ro;
  flash($('ntMsg'),'');
  hcClear();
  if(editNotaId){
    const n=store.get('notas',[]).find(x=>x.id===editNotaId); if(!n){ return; }
    $('notaTit').textContent=(soloLectura?'Ver ':'Editar ')+(n.tipo||'nota').toLowerCase();
    $('ntTipo').value=n.tipo; $('ntPac').value=n.pac||'—'; $('ntDoc').value=n.doc||'';
    $('ntMed').value=n.medico||''; $('ntTexto').value=n.texto||''; $('ntFecha').value=isoToLocalInput(n.fecha);
    hcToggle(n.tipo); if(esHC(n.tipo)) hcFill(n.hc);
    $('notaGuardar').textContent='Actualizar nota';
  } else {
    if(!regPac){ flash($('regMsg'),'Primero busque y seleccione un paciente.','err'); return; }
    if(!puedeCrear(regTipo)){ flash($('regMsg'),'Su perfil no tiene permiso para crear este tipo de nota.','err'); return; }
    $('notaTit').textContent='Nueva '+(regTipo||'nota').toLowerCase();
    $('ntTipo').value=regTipo; $('ntPac').value=regPac.nombre||'—'; $('ntDoc').value=regPac.doc;
    $('ntMed').value=(CURRENT&&(CURRENT.nombre||CURRENT.usuario))||''; $('ntTexto').value=''; $('ntFecha').value=isoToLocalInput();
    hcToggle(regTipo);
    $('notaGuardar').textContent='Guardar nota';
  }
  aplicarSoloLectura(soloLectura);
  $('ovNota').hidden=false; setTimeout(()=>$('ntMed').focus(),50);
}
/* bloquea/desbloquea el formulario para el modo solo lectura (sin permiso de creación) */
function aplicarSoloLectura(ro){
  const editables=['ntMed','ntTexto','ntFecha'].concat(HC_FIELDS);
  editables.forEach(id=>{ const el=$(id); if(el) el.disabled=!!ro; });
  document.querySelectorAll('#formNota .normbtn, #formNota .normall').forEach(b=> b.disabled=!!ro);
  const g=$('notaGuardar'); if(g) g.hidden=!!ro;
  const c=$('notaCancel'); if(c) c.textContent = ro?'Cerrar':'Cancelar';
}
function cerrarNota(){ $('ovNota').hidden=true; editNotaId=null; soloLectura=false; }
$('regNueva').addEventListener('click', ()=> abrirNota());
$('notaX').addEventListener('click', cerrarNota);
$('notaCancel').addEventListener('click', cerrarNota);
$('formNota').addEventListener('submit', (e)=>{
  e.preventDefault();
  const tipo=$('ntTipo').value;
  if(soloLectura){ cerrarNota(); return; }
  if(!puedeCrear(tipo)){ flash($('ntMsg'),'No tiene permiso para crear o editar este tipo de nota.','err'); return; }
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
  const med=$('csMed')?$('csMed').value:'';
  const d1=$('csD1').value, d2=$('csD2').value;
  if(!doc){ flash($('csMsg'),'Indica el número de documento del paciente.','err'); return null; }
  let lista=store.get('notas',[]).filter(n=> (n.doc||'').trim()===doc);
  if(serv) lista=lista.filter(n=> n.tipo===serv);
  if(med) lista=lista.filter(n=> (n.medico||'').trim()===med);
  if(d1) lista=lista.filter(n=> fechaSoloDia(n.fecha) >= d1);
  if(d2) lista=lista.filter(n=> fechaSoloDia(n.fecha) <= d2);
  lista.sort((a,b)=> (a.fecha||'').localeCompare(b.fecha||''));
  return lista;
}
/* llena el filtro de profesionales con los nombres que ya figuran en las notas */
function refreshMedList(){
  const sel=$('csMed'); if(!sel) return;
  const prev=sel.value;
  const set=new Set();
  store.get('notas',[]).forEach(n=>{ const m=(n.medico||'').trim(); if(m) set.add(m); });
  const nombres=Array.from(set).sort((a,b)=> a.localeCompare(b));
  sel.innerHTML='';
  const o0=document.createElement('option'); o0.value=''; o0.textContent='Todos los profesionales'; sel.appendChild(o0);
  nombres.forEach(m=>{ const o=document.createElement('option'); o.value=m; o.textContent=m; sel.appendChild(o); });
  if(prev && set.has(prev)) sel.value=prev;
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
$('csLimpiar').addEventListener('click', ()=>{ $('csDoc').value=''; $('csServ').value=''; if($('csMed'))$('csMed').value=''; $('csD1').value=''; $('csD2').value=''; renderConsulta([]); $('csPac').textContent=''; flash($('csMsg'),''); });
$('csServ').addEventListener('change', ()=>{ if($('csDoc').value.trim()){ const l=consultaFiltrar(); if(l) renderConsulta(l); } });
if($('csMed')) $('csMed').addEventListener('change', ()=>{ if($('csDoc').value.trim()){ const l=consultaFiltrar(); if(l) renderConsulta(l); } });
['csD1','csD2'].forEach(id=>{ if($(id)) $(id).addEventListener('change', ()=>{ if($('csDoc').value.trim()){ const l=consultaFiltrar(); if(l) renderConsulta(l); } }); });
$('csPdf').addEventListener('click', consultaPDF);

function consultaPDF(){
  if(!csResultados.length){ flash($('csMsg'),'Primero realiza una consulta con resultados.','err'); return; }
  if(!(window.jspdf && window.jspdf.jsPDF)){ flash($('csMsg'),'No se pudo cargar el generador de PDF.','err'); return; }
  const doc=$('csDoc').value.trim();
  const nombre=csResultados[0].pac || nombrePorDoc(doc) || '—';
  const d1=$('csD1').value, d2=$('csD2').value, serv=$('csServ').value;
  const med=$('csMed')?$('csMed').value:'';
  /* nota sintética: reutiliza el mismo encabezado + ficha de paciente
     (desde la admisión) que la historia clínica; sin firma única. */
  const synth={ doc:doc, pac:nombre, fecha:new Date().toISOString(), medico:(med||''), firma:'' };
  const { d } = construirDoc(synth, 'Reporte de servicios clínicos', (ctx)=>{
    ctx.band('Parámetros del reporte');
    ctx.campo('Rango', (d1||d2) ? ((d1||'inicio')+' a '+(d2||'hoy')) : 'Todas las fechas');
    ctx.campo('Servicio', serv||'Todos');
    ctx.campo('Profesional', med||'Todos');
    ctx.campo('Total', csResultados.length+' registro(s)');
    csResultados.forEach((n,i)=>{
      ctx.band((i+1)+'. '+(n.tipo||'Registro clínico'));
      ctx.campo('Fecha', fmtFecha(n.fecha));
      ctx.campo('Profesional', n.medico||'—');
      if(n.especialidad){ ctx.campo('Especialidad', n.especialidad); }
      if(n.registro){ ctx.campo('Registro médico', n.registro); }
      ctx.campo('Contenido', (n.texto&&n.texto.trim())?n.texto:'(sin contenido)');
    });
  }, { sinFirma:true });
  const safe=(nombre||'paciente').replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'').toLowerCase();
  d.save('reporte_'+(doc||'doc')+'_'+safe+'.pdf');
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
/* ============================================================
   PDF HISTORIA CLÍNICA + documentos aparte (paraclínicos,
   orden médica, fórmula médica). Vista previa antes de imprimir.
   ============================================================ */

/* construye un documento base (encabezado IPS + recuadro paciente +
   firma + pie) y delega el cuerpo a drawBody(ctx). Devuelve {d, nombre}. */
function construirDoc(note, titulo, drawBody, opts){
  opts=opts||{};
  const { jsPDF } = window.jspdf;
  const d = new jsPDF({ unit:'pt', format:'a4' });
  const ml=42, mr=42, mt=46; const pw=d.internal.pageSize.getWidth(), ph=d.internal.pageSize.getHeight();
  const ancho = pw-ml-mr; let y=mt;
  const ips=store.get('ips',{});
  const a=admisionPorDoc(note.doc)||{};
  const INK=[20,28,40], GRIS=[90,100,115], LINEA=[120,135,150];

  function nl(h){ if(y+h > ph-56){ d.addPage(); y=mt; } }
  function band(titulo){
    nl(26); y+=4;
    d.setFillColor(11,22,34); d.setDrawColor(11,22,34);
    d.rect(ml, y-11, ancho, 17, 'F');
    d.setFont('helvetica','bold'); d.setFontSize(9.5); d.setTextColor(255,255,255);
    d.text(titulo.toUpperCase(), ml+6, y+1); y+=16;
    d.setTextColor(INK[0],INK[1],INK[2]);
  }
  function campo(label, valor){
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
  let txtX=ml;
  if(ips.logo && /^data:image\/(png|jpeg)/.test(ips.logo)){
    try{
      const fmt=/^data:image\/png/.test(ips.logo)?'PNG':'JPEG';
      let lw=52, lh=52;
      try{ const pr=d.getImageProperties(ips.logo); if(pr&&pr.width&&pr.height){ lw=Math.min(64, 52*pr.width/pr.height); lh=52; if(lw>72){ lw=72; lh=72*pr.height/pr.width; } } }catch(_){}
      d.addImage(ips.logo, fmt, ml, y-2, lw, lh);
      txtX=ml+lw+12;
    }catch(_){ }
  }
  d.setFont('helvetica','bold'); d.setFontSize(15); d.setTextColor(11,22,34);
  if(ips.nombre){ d.text(ips.nombre, txtX, y); y+=16; }
  d.setFont('helvetica','normal'); d.setFontSize(8.5); d.setTextColor(GRIS[0],GRIS[1],GRIS[2]);
  const sub=[ips.nit?('NIT '+ips.nit):'', ips.hab?('Habilitación '+ips.hab):''].filter(Boolean).join('     ·     ');
  if(sub){ d.text(sub, txtX, y); y+=12; }
  if(!ips.nombre && !sub){ y+=16; }
  if(y < mt+54){ y = mt+54; }
  d.setDrawColor(LINEA[0],LINEA[1],LINEA[2]); d.setLineWidth(0.8); d.line(ml,y,pw-mr,y); y+=4;
  d.setFont('helvetica','bold'); d.setFontSize(11.5); d.setTextColor(11,22,34);
  d.text(String(titulo).toUpperCase(), pw/2, y+12, {align:'center'}); y+=22;

  /* ---------- datos del paciente (recuadro) ---------- */
  const nombre=note.pac || nombrePaciente(a) || '—';
  const tipoDoc=a.tipoDoc?(a.tipoDoc+' '):'';
  const boxTop=y; y+=12;
  const colL=ml+6, colR=ml+ancho/2+4;
  function par(xl, label, val){
    d.setFont('helvetica','bold'); d.setFontSize(8.5); d.setTextColor(60,72,88);
    d.text(label+': ', xl, y);
    const w=d.getTextWidth(label+': ');
    d.setFont('helvetica','normal'); d.setTextColor(INK[0],INK[1],INK[2]);
    d.text(String(val||'—'), xl+w, y);
  }
  par(colL,'Paciente',nombre); par(colR,'Documento',tipoDoc+(note.doc||'')); y+=13;
  par(colL,'Sexo',a.sexo||'—'); par(colR,'Fecha nac.',a.nac||'—'); y+=13;
  par(colL,'Dirección',a.dir||'—'); par(colR,'Teléfono',a.tel||'—'); y+=13;
  par(colL,'EPS / Aseguradora',a.eps||'—'); par(colR,'Régimen',a.regimen||'—'); y+=13;
  par(colL,'Fecha de atención',fmtFecha(note.fecha)); par(colR,'Profesional',note.medico||'—'); y+=6;
  d.setDrawColor(LINEA[0],LINEA[1],LINEA[2]); d.setLineWidth(0.8);
  d.rect(ml, boxTop, ancho, y-boxTop);
  y+=8;

  /* ---------- cuerpo ---------- */
  drawBody({ band, campo });

  /* ---------- firma del profesional ---------- */
  if(!opts.sinFirma){
  nl(80); y+=18;
  const fx=ml+4;
  if(note.firma && /^data:image\/(png|jpeg)/.test(note.firma)){
    try{
      const fmt=/^data:image\/png/.test(note.firma)?'PNG':'JPEG';
      let fw=150, fh=52;
      try{ const pr=d.getImageProperties(note.firma); if(pr&&pr.width&&pr.height){ fh=Math.min(56, fw*pr.height/pr.width); } }catch(_){}
      d.addImage(note.firma, fmt, fx, y-fh, fw, fh);
    }catch(_){ }
  }
  d.setDrawColor(INK[0],INK[1],INK[2]); d.setLineWidth(0.8); d.line(fx, y, fx+200, y); y+=12;
  d.setFont('helvetica','bold'); d.setFontSize(9.5); d.setTextColor(INK[0],INK[1],INK[2]);
  d.text((note.medico||'—'), fx, y); y+=12;
  d.setFont('helvetica','normal'); d.setFontSize(8.5); d.setTextColor(GRIS[0],GRIS[1],GRIS[2]);
  if(note.especialidad){ d.text(note.especialidad, fx, y); y+=11; }
  if(note.registro){ d.text('Registro médico: '+note.registro, fx, y); y+=11; }
  }

  /* ---------- pie con numeración ---------- */
  const tot=d.internal.getNumberOfPages();
  for(let p=1;p<=tot;p++){
    d.setPage(p); d.setFontSize(7.5); d.setTextColor(150,160,172);
    const pie=[ips.nombre||'', titulo, 'página '+p+' de '+tot].filter(Boolean).join(' · ');
    d.text(pie, ml, ph-26);
    d.text('Documento generado el '+fmtFecha(new Date().toISOString()), pw-mr, ph-26, {align:'right'});
  }
  return { d, nombre };
}

/* cuerpo de la historia clínica (sin paraclínicos / órdenes / fórmula) */
function cuerpoHistoria(ctx, hc){
  ctx.band('Motivo de la consulta'); ctx.campo('', hc.hcMotivo);
  ctx.band('Enfermedad actual'); ctx.campo('', hc.hcEnf);
  ctx.band('Revisión por sistemas · Signos vitales');
  const vit=[['TA',hc.hcTA,'mmHg'],['FC',hc.hcFC,'lpm'],['FR',hc.hcFR,'rpm'],['Temp',hc.hcT,'°C'],
             ['SatO2',hc.hcSat,'%'],['Peso',hc.hcPeso,'kg'],['Talla',hc.hcTalla,'cm'],['IMC',hc.hcIMC,'']];
  const vitTxt=vit.filter(v=>v[1]).map(v=> v[0]+': '+v[1]+(v[2]?(' '+v[2]):'')).join('     ');
  ctx.campo('', vitTxt || '—');
  if(hc.hcDxNut) ctx.campo('Dx nutricional', hc.hcDxNut);
  ctx.band('Antecedentes');
  ctx.campo('Personales', hc.hcAntPer);
  ctx.campo('Familiares', hc.hcAntFam);
  ctx.campo('Alergias', hc.hcAlerg);
  ctx.campo('Quirúrgicos', hc.hcQuir);
  if(hc.hcGineco) ctx.campo('Gineco-obstétricos', hc.hcGineco);
  ctx.band('Examen físico');
  ctx.campo('Estado general y conciencia', hc.hcExGen);
  ctx.campo('Cabeza, cara y cuello', hc.hcExCab);
  ctx.campo('Tórax', hc.hcExTorax);
  ctx.campo('Abdomen', hc.hcExAbd);
  if(hc.hcExGen2) ctx.campo('Genitales', hc.hcExGen2);
  ctx.campo('Extremidades', hc.hcExExt);
  ctx.campo('Sistema nervioso central', hc.hcExSNC);
  ctx.campo('Piel y faneras', hc.hcExPiel);
  ctx.band('Diagnóstico');
  const dxs=(hc.hcDx||'').split(/\n+/).filter(Boolean);
  if(dxs.length) dxs.forEach((dx,i)=> ctx.campo('', (i+1)+'. '+dx)); else ctx.campo('', '—');
  ctx.band('Plan'); ctx.campo('', hc.hcPlan);
}

function nombreArchivo(prefijo, note, nombre){
  const safe=(nombre||'paciente').replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'').toLowerCase();
  return prefijo+'_'+(note.doc||'doc')+'_'+safe+'.pdf';
}

/* genera SOLO la historia clínica */
function generarHistoria(note){
  const hc=note.hc||{};
  const g=construirDoc(note, 'Historia clínica – Consulta externa', (ctx)=> cuerpoHistoria(ctx, hc));
  g.d.save(nombreArchivo('historia_clinica', note, g.nombre));
}
/* genera un documento aparte (paraclínicos / orden / fórmula) */
function generarExtra(note, titulo, contenido, prefijo){
  const g=construirDoc(note, titulo, (ctx)=>{
    ctx.band(titulo);
    const lineas=(contenido||'').split(/\n+/).map(s=>s.trim()).filter(Boolean);
    if(lineas.length>1) lineas.forEach((ln,i)=> ctx.campo('', (i+1)+'. '+ln));
    else ctx.campo('', contenido);
  });
  g.d.save(nombreArchivo(prefijo, note, g.nombre));
}

/* lista de documentos aparte presentes en una nota */
function extrasDeNota(hc){
  hc=hc||{};
  const out=[];
  if((hc.hcPara||'').trim())    out.push({titulo:'Paraclínicos',  campo:'hcPara',    prefijo:'paraclinicos'});
  if((hc.hcOrdenes||'').trim()) out.push({titulo:'Orden médica',  campo:'hcOrdenes', prefijo:'orden_medica'});
  if((hc.hcFormula||'').trim()) out.push({titulo:'Fórmula médica',campo:'hcFormula', prefijo:'formula_medica'});
  return out;
}

/* dispatcher: descarga la historia + cada documento aparte en PDF separados */
function historiaClinicaPDF(id){
  const n=store.get('notas',[]).find(x=>x.id===id);
  if(!n){ return; }
  if(!(window.jspdf && window.jspdf.jsPDF)){ flash($('regMsg'),'No se pudo cargar el generador de PDF.','err'); return; }
  const hc=n.hc||{};
  generarHistoria(n);
  extrasDeNota(hc).forEach(e=> generarExtra(n, e.titulo, hc[e.campo], e.prefijo));
  const extra=extrasDeNota(hc).length;
  flash($('regMsg'), 'PDF generado'+(extra?(' + '+extra+' documento(s) aparte'):'')+'.', 'ok');
}

/* ---------- VISTA PREVIA (antes de imprimir) ---------- */
function prevSeccion(cont, label, valor){
  if(valor==null || String(valor).trim()==='') valor='—';
  const d=document.createElement('div'); d.className='psec';
  if(label){ const b=document.createElement('b'); b.textContent=label+': '; d.appendChild(b); }
  const v=document.createElement('span'); v.className='pval'; v.textContent=String(valor); d.appendChild(v);
  cont.appendChild(d);
}
function prevTarjeta(titulo, nombre, note, llenar){
  const card=document.createElement('div'); card.className='prevdoc';
  const ips=store.get('ips',{});
  const h5=document.createElement('h5'); h5.textContent=(ips.nombre||'IPS'); card.appendChild(h5);
  const t=document.createElement('div'); t.className='ptitle'; t.textContent=titulo; card.appendChild(t);
  const meta=document.createElement('div'); meta.className='pmeta';
  meta.textContent='Paciente: '+nombre+'  ·  Documento: '+(note.doc||'—')+'  ·  Fecha: '+fmtFecha(note.fecha)+'  ·  Profesional: '+(note.medico||'—');
  card.appendChild(meta);
  llenar(card);
  return card;
}
function hcPreview(id){
  const n=store.get('notas',[]).find(x=>x.id===id);
  if(!n){ return; }
  const hc=n.hc||{};
  const a=admisionPorDoc(n.doc)||{};
  const nombre=n.pac || nombrePaciente(a) || '—';
  const docs=$('prevDocs'); docs.innerHTML='';
  const acts=$('prevActions'); acts.innerHTML='';

  // tarjeta historia clínica
  docs.appendChild(prevTarjeta('Historia clínica – Consulta externa', nombre, n, (card)=>{
    prevSeccion(card,'Motivo', hc.hcMotivo);
    prevSeccion(card,'Enfermedad actual', hc.hcEnf);
    const vit=[['TA',hc.hcTA],['FC',hc.hcFC],['FR',hc.hcFR],['Temp',hc.hcT],['SatO2',hc.hcSat],['Peso',hc.hcPeso],['Talla',hc.hcTalla],['IMC',hc.hcIMC]];
    prevSeccion(card,'Signos vitales', vit.filter(v=>v[1]).map(v=>v[0]+' '+v[1]).join('   ')||'—');
    prevSeccion(card,'Antecedentes personales', hc.hcAntPer);
    prevSeccion(card,'Examen físico – Abdomen', hc.hcExAbd);
    prevSeccion(card,'Diagnóstico', (hc.hcDx||'').split(/\n+/).filter(Boolean).join('; '));
    prevSeccion(card,'Plan', hc.hcPlan);
  }));

  // tarjetas de documentos aparte
  extrasDeNota(hc).forEach(e=>{
    docs.appendChild(prevTarjeta(e.titulo+'  (documento aparte)', nombre, n, (card)=>{
      prevSeccion(card,'', hc[e.campo]);
    }));
  });

  // acciones
  const bH=document.createElement('button'); bH.className='btn mini'; bH.textContent='Descargar historia clínica';
  bH.addEventListener('click', ()=> generarHistoria(n));
  acts.appendChild(bH);
  extrasDeNota(hc).forEach(e=>{
    const bt=document.createElement('button'); bt.className='btn ghost mini'; bt.textContent='Descargar '+e.titulo.toLowerCase();
    bt.addEventListener('click', ()=> generarExtra(n, e.titulo, hc[e.campo], e.prefijo));
    acts.appendChild(bt);
  });
  const bAll=document.createElement('button'); bAll.className='btn mini'; bAll.textContent='Descargar todo';
  bAll.addEventListener('click', ()=> historiaClinicaPDF(n.id));
  acts.appendChild(bAll);
  const bC=document.createElement('button'); bC.className='btn ghost mini'; bC.textContent='Cerrar';
  bC.addEventListener('click', cerrarPrev);
  acts.appendChild(bC);

  $('ovPrev').hidden=false;
}
function cerrarPrev(){ $('ovPrev').hidden=true; }
(function(){
  const x=$('prevX'); if(x) x.addEventListener('click', cerrarPrev);
})();

/* ============================================================
   MÓDULO 3 · CONFIGURACIONES (parámetros IPS + usuarios)
   ============================================================ */
/* -- parámetros de la IPS -- */
let ipsLogoData = null; /* dataURL del logo cargado */
function loadIps(){
  const p=store.get('ips',{});
  $('ipsNombre').value=p.nombre||''; $('ipsNit').value=p.nit||''; $('ipsHab').value=p.hab||'';
  ipsLogoData = (p.logo && /^data:image\/(png|jpeg)/.test(p.logo)) ? p.logo : null;
  const prev=$('ipsLogoPrev');
  if(prev){
    if(ipsLogoData){ prev.src=ipsLogoData; prev.hidden=false; }
    else { prev.hidden=true; prev.removeAttribute('src'); }
  }
}
if($('ipsLogoFile')){
  $('ipsLogoFile').addEventListener('change', ()=>{
    const f=$('ipsLogoFile').files[0], prev=$('ipsLogoPrev');
    if(!f){ return; }
    if(!/image\/(png|jpeg)/.test(f.type)){ flash($('ipsMsg'),'El logo debe ser PNG o JPEG.','err'); $('ipsLogoFile').value=''; return; }
    const r=new FileReader();
    r.onload=()=>{ ipsLogoData=r.result; if(prev){ prev.src=r.result; prev.hidden=false; } };
    r.readAsDataURL(f);
  });
}
if($('ipsLogoQuitar')){
  $('ipsLogoQuitar').addEventListener('click', ()=>{
    ipsLogoData=null; $('ipsLogoFile').value='';
    const prev=$('ipsLogoPrev'); if(prev){ prev.hidden=true; prev.removeAttribute('src'); }
  });
}
$('formIps').addEventListener('submit', (e)=>{
  e.preventDefault();
  store.set('ips',{ nombre:$('ipsNombre').value.trim(), nit:$('ipsNit').value.trim(), hab:$('ipsHab').value.trim(), logo:ipsLogoData||'' });
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
/* -- matriz de CREACIÓN de notas por tipo (quien no tenga el permiso solo podrá VER) -- */
function renderCrear(){
  const tb=$('usrCrearTb'); if(!tb) return; tb.innerHTML='';
  usuarios().forEach(u=>{
    const tr=document.createElement('tr');
    tr.appendChild(td(u.usuario));
    const rc=document.createElement('td'); const rp=document.createElement('span'); rp.className='pill '+((u.rol==='maestro'||u.rol==='admin')?'cy':'gr'); rp.textContent=ROLES[u.rol]||u.rol; rc.appendChild(rp); tr.appendChild(rc);
    TIPOS_NOTA.forEach(t=>{
      const c=document.createElement('td'); c.className='csw';
      const lab=document.createElement('label'); lab.className='sw';
      const inp=document.createElement('input'); inp.type='checkbox';
      inp.checked=(u.rol==='maestro')?true:!!(u.perms&&u.perms.crear&&u.perms.crear[t.key]);
      if(u.rol==='maestro') inp.disabled=true;
      inp.addEventListener('change', ()=>{ const l=usuarios(); const x=l.find(y=>y.id===u.id); if(!x) return; if(!x.perms) x.perms={}; if(!x.perms.crear) x.perms.crear={}; x.perms.crear[t.key]=inp.checked; setUsuarios(l); });
      const tk=document.createElement('span'); tk.className='track';
      lab.appendChild(inp); lab.appendChild(tk); c.appendChild(lab); tr.appendChild(c);
    });
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
      bd.addEventListener('click', ()=>{ if(confirm('¿Eliminar el usuario '+u.usuario+'?')){ setUsuarios(usuarios().filter(x=>x.id!==u.id)); renderUsr(); renderCrear(); renderUsrList(); } });
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
  if(name==='eps' && typeof renderEps==='function') renderEps();
  if(name==='seguridad' && typeof segInfo==='function') segInfo();
  if(name==='limpiar' && typeof limInfoRefrescar==='function') limInfoRefrescar();
}
(function(){
  const nav=$('cfgNav');
  if(nav) nav.addEventListener('click', (e)=>{ const b=e.target.closest('[data-cfg]'); if(b) cfgTab(b.getAttribute('data-cfg')); });
})();

/* ============================================================
   LIMPIAR SISTEMA · borra SOLO pacientes (admisiones + notas)
   Conserva intactos: usuarios, EPS e IPS.
   ============================================================ */
function limInfoRefrescar(){
  const info=$('limInfo'); if(!info) return;
  const nPac = store.get('admisiones',[]).length;
  const nNotas = store.get('notas',[]).length;
  info.textContent = 'Actualmente hay '+nPac+' paciente(s) y '+nNotas+' nota(s) de historia clínica. Se eliminarán todos; los usuarios, EPS e IPS NO se tocan.';
  const i=$('limConfirm'); if(i) i.value='';
  const m=$('limMsg'); if(m){ m.textContent=''; m.className='msg'; }
}
(function(){
  const btn=$('btnLimpiar'); if(!btn) return;
  btn.addEventListener('click', ()=>{
    const msg=$('limMsg');
    const txt=(($('limConfirm')&&$('limConfirm').value)||'').trim().toUpperCase();
    if(txt!=='BORRAR'){ flash(msg,'Escriba la palabra BORRAR para confirmar.','err'); return; }
    if(!confirm('¿Seguro que desea borrar TODOS los pacientes y sus notas? Los usuarios, EPS e IPS se conservan. Esta acción no se puede deshacer.')) return;
    store.set('admisiones', []);
    store.set('notas', []);
    if($('limConfirm')) $('limConfirm').value='';
    try{ refreshPacList(); renderReg&&renderReg(); renderAdm&&renderAdm(); refreshMedList&&refreshMedList(); }catch(e){}
    if(msg){ msg.className='msg ok'; msg.textContent='✓ Sistema limpio. Se borraron los pacientes y sus notas; usuarios, EPS e IPS intactos.'; }
    limInfoRefrescar();
    if(msg){ msg.className='msg ok'; msg.textContent='✓ Sistema limpio. Se borraron los pacientes y sus notas; usuarios, EPS e IPS intactos.'; }
  });
})();

/* ============================================================
   RESPALDO · Exportar / Importar (traslado manual entre equipos)
   No es sincronización ni servidor: genera/lee un archivo JSON.
   ============================================================ */
const BK_CLAVES = ['usuarios','admisiones','notas','ips','eps'];

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
  flash($('usrMsg'),'Usuario creado con permisos de '+(ROLES[rol]||rol)+'.','ok'); renderUsr(); renderCrear(); renderUsrList();
});

/* ============================================================
   SEGURIDAD · Cambio de contraseña del usuario activo
   ============================================================ */
function segInfo(){
  const el=$('segUser'); if(el) el.textContent=(CURRENT&&(CURRENT.usuario||'su usuario'))||'su usuario';
}
if($('formPwd')){
  $('formPwd').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const u=sesionUser();
    if(!u){ flash($('pwMsg'),'Debe iniciar sesión para cambiar la contraseña.','err'); return; }
    const act=$('pwActual').value, n1=$('pwNueva').value, n2=$('pwNueva2').value;
    const chk=await hashPwd(act, u.salt);
    if(chk.hash!==u.hash){ flash($('pwMsg'),'La contraseña actual no es correcta.','err'); return; }
    if(n1.length<8 || !/[a-z]/i.test(n1) || !/[0-9]/.test(n1)){ flash($('pwMsg'),'La nueva contraseña debe tener 8+ caracteres con letras y números.','err'); return; }
    if(n1!==n2){ flash($('pwMsg'),'Las nuevas contraseñas no coinciden.','err'); return; }
    if(n1===act){ flash($('pwMsg'),'La nueva contraseña debe ser distinta a la actual.','err'); return; }
    const h=await hashPwd(n1);
    const l=usuarios(); const t=l.find(x=>x.id===u.id);
    if(!t){ flash($('pwMsg'),'No se encontró el usuario.','err'); return; }
    t.salt=h.salt; t.hash=h.hash; setUsuarios(l);
    if(CURRENT && CURRENT.id===t.id){ CURRENT.salt=t.salt; CURRENT.hash=t.hash; }
    $('pwActual').value=''; $('pwNueva').value=''; $('pwNueva2').value='';
    flash($('pwMsg'),'Contraseña actualizada correctamente.','ok');
  });
}

/* ============================================================
   GESTIÓN DE EPS · entidades a las que se presta el servicio
   ============================================================ */
let epsEditId = null;
function epsLista(){ return store.get('eps', []); }
function setEps(l){ store.set('eps', l); }
function epsLimpiarForm(){
  epsEditId=null;
  ['epsCodigo','epsNombre','epsUrl','epsNit','epsTel','epsEmail','epsObs'].forEach(id=>{ if($(id)) $(id).value=''; });
  if($('epsRegimen')) $('epsRegimen').selectedIndex=0;
  if($('epsGuardar')) $('epsGuardar').textContent='Guardar EPS';
}
function epsRefrescarDatalist(){
  const dl=$('epsListDL'); if(!dl) return;
  dl.textContent='';
  epsLista().filter(e=>e.activo!==false).forEach(e=>{
    const o=document.createElement('option'); o.value=e.nombre||''; dl.appendChild(o);
  });
}
function renderEps(){
  const tb=$('epsTb'); if(!tb) return;
  const l=epsLista(); tb.textContent='';
  const cnt=$('epsCount'); if(cnt) cnt.textContent=l.length+' EPS';
  if(!l.length){
    const tr=document.createElement('tr'); const td=document.createElement('td');
    td.colSpan=8; td.className='hint'; td.style.textAlign='center'; td.textContent='Aún no hay EPS registradas.';
    tr.appendChild(td); tb.appendChild(tr); return;
  }
  l.forEach(e=>{
    const tr=document.createElement('tr');
    [e.codigo||'—', e.nombre||'—', e.regimen||'—', e.nit||'—', e.tel||'—', e.email||'—'].forEach(v=>{
      const td=document.createElement('td'); td.textContent=v; tr.appendChild(td);
    });
    /* activo */
    const ca=document.createElement('td');
    const lab=document.createElement('label'); lab.className='sw';
    const inp=document.createElement('input'); inp.type='checkbox'; inp.checked=(e.activo!==false);
    inp.addEventListener('change', ()=>{ const ll=epsLista(); const t=ll.find(x=>x.id===e.id); if(t){ t.activo=inp.checked; setEps(ll); epsRefrescarDatalist(); } });
    const tk=document.createElement('span'); tk.className='track';
    lab.appendChild(inp); lab.appendChild(tk); ca.appendChild(lab); tr.appendChild(ca);
    /* acciones */
    const ac=document.createElement('td');
    const bt=document.createElement('button'); bt.className='btn ghost mini'; bt.type='button'; bt.textContent='Editar';
    bt.addEventListener('click', ()=>{
      epsEditId=e.id;
      $('epsCodigo').value=e.codigo||''; $('epsNombre').value=e.nombre||''; $('epsUrl').value=e.url||'';
      $('epsRegimen').value=e.regimen||'Contributivo'; $('epsNit').value=e.nit||''; $('epsTel').value=e.tel||'';
      $('epsEmail').value=e.email||''; $('epsObs').value=e.obs||'';
      if($('epsGuardar')) $('epsGuardar').textContent='Actualizar EPS';
      $('epsCodigo').focus();
    });
    const bd=document.createElement('button'); bd.className='btn del mini'; bd.type='button'; bd.textContent='Eliminar';
    bd.addEventListener('click', ()=>{ if(confirm('¿Eliminar la EPS '+(e.nombre||'')+'?')){ setEps(epsLista().filter(x=>x.id!==e.id)); if(epsEditId===e.id) epsLimpiarForm(); renderEps(); epsRefrescarDatalist(); } });
    ac.appendChild(bt); ac.appendChild(document.createTextNode(' ')); ac.appendChild(bd); tr.appendChild(ac);
    tb.appendChild(tr);
  });
}
if($('formEps')){
  $('formEps').addEventListener('submit', (e)=>{
    e.preventDefault();
    const nombre=$('epsNombre').value.trim();
    if(!nombre){ flash($('epsMsg'),'El nombre de la EPS es obligatorio.','err'); return; }
    const datos={ codigo:$('epsCodigo').value.trim(), nombre:nombre, url:$('epsUrl').value.trim(),
      regimen:$('epsRegimen').value, nit:$('epsNit').value.trim(), tel:$('epsTel').value.trim(),
      email:$('epsEmail').value.trim(), obs:$('epsObs').value.trim() };
    const l=epsLista();
    if(epsEditId){
      const t=l.find(x=>x.id===epsEditId);
      if(t){ Object.assign(t, datos); setEps(l); flash($('epsMsg'),'EPS actualizada.','ok'); }
    } else {
      datos.id=uid(); datos.activo=true; l.push(datos); setEps(l);
      flash($('epsMsg'),'EPS registrada.','ok');
    }
    epsLimpiarForm(); renderEps(); epsRefrescarDatalist();
  });
}
if($('epsLimpiar')) $('epsLimpiar').addEventListener('click', ()=>{ epsLimpiarForm(); flash($('epsMsg'),'',''); });

/* ============================================================
   CALENDARIO EMERGENTE · con botón "Aceptar" para salir
   Se engancha a cualquier input .datepick (texto, readonly).
   El valor del input queda como AAAA-MM-DD (compatible con los
   filtros existentes). Se dispara 'change' al aceptar o borrar.
   ============================================================ */
(function(){
  const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const DOW=['Lu','Ma','Mi','Ju','Vi','Sá','Do'];
  let pop=null, target=null, view=null, sel=null;

  function pad(n){ return (n<10?'0':'')+n; }
  function iso(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function parseISO(s){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||''); if(!m) return null; const d=new Date(+m[1],+m[2]-1,+m[3]); return isNaN(d)?null:d; }

  function build(){
    pop=document.createElement('div'); pop.className='cal'; pop.hidden=true;
    const head=document.createElement('div'); head.className='cal-head';
    const prev=document.createElement('button'); prev.type='button'; prev.className='cal-nav'; prev.textContent='‹';
    const title=document.createElement('span'); title.className='cal-title';
    const next=document.createElement('button'); next.type='button'; next.className='cal-nav'; next.textContent='›';
    head.appendChild(prev); head.appendChild(title); head.appendChild(next);
    const dow=document.createElement('div'); dow.className='cal-dow';
    DOW.forEach(x=>{ const s=document.createElement('span'); s.textContent=x; dow.appendChild(s); });
    const grid=document.createElement('div'); grid.className='cal-grid';
    const foot=document.createElement('div'); foot.className='cal-foot';
    const borrar=document.createElement('button'); borrar.type='button'; borrar.className='btn ghost'; borrar.textContent='Borrar';
    const aceptar=document.createElement('button'); aceptar.type='button'; aceptar.className='btn'; aceptar.textContent='Aceptar';
    foot.appendChild(borrar); foot.appendChild(aceptar);
    pop.appendChild(head); pop.appendChild(dow); pop.appendChild(grid); pop.appendChild(foot);
    document.body.appendChild(pop);

    prev.addEventListener('click', ()=>{ view.setMonth(view.getMonth()-1); paint(title, grid); });
    next.addEventListener('click', ()=>{ view.setMonth(view.getMonth()+1); paint(title, grid); });
    borrar.addEventListener('click', ()=>{ if(target){ target.value=''; target.dispatchEvent(new Event('change',{bubbles:true})); } cerrar(); });
    aceptar.addEventListener('click', ()=>{ if(target){ target.value=sel?iso(sel):''; target.dispatchEvent(new Event('change',{bubbles:true})); } cerrar(); });
    pop._title=title; pop._grid=grid;
  }

  function paint(title, grid){
    const y=view.getFullYear(), m=view.getMonth();
    title.textContent=MESES[m]+' '+y;
    grid.textContent='';
    const first=new Date(y,m,1);
    let start=first.getDay(); start=(start===0)?6:start-1; /* lunes primero */
    const diasMes=new Date(y,m+1,0).getDate();
    const hoy=iso(new Date());
    for(let i=0;i<start;i++){ const b=document.createElement('button'); b.type='button'; b.className='cal-day muted'; b.textContent=''; b.disabled=true; grid.appendChild(b); }
    for(let d=1;d<=diasMes;d++){
      const cur=new Date(y,m,d); const ciso=iso(cur);
      const b=document.createElement('button'); b.type='button'; b.className='cal-day'; b.textContent=String(d);
      if(ciso===hoy) b.classList.add('today');
      if(sel && iso(sel)===ciso) b.classList.add('sel');
      b.addEventListener('click', ()=>{ sel=cur; grid.querySelectorAll('.cal-day.sel').forEach(x=>x.classList.remove('sel')); b.classList.add('sel'); });
      grid.appendChild(b);
    }
  }

  function abrir(inp){
    if(!pop) build();
    target=inp;
    sel=parseISO(inp.value);
    view=sel?new Date(sel.getFullYear(), sel.getMonth(), 1):new Date();
    paint(pop._title, pop._grid);
    pop.hidden=false;
    const r=inp.getBoundingClientRect();
    let top=r.bottom+window.scrollY+6, left=r.left+window.scrollX;
    const pw=280; if(left+pw>window.scrollX+document.documentElement.clientWidth-8){ left=window.scrollX+document.documentElement.clientWidth-pw-8; }
    if(left<window.scrollX+8) left=window.scrollX+8;
    pop.style.top=top+'px'; pop.style.left=left+'px';
  }
  function cerrar(){ if(pop){ pop.hidden=true; } target=null; }

  document.addEventListener('click', (e)=>{
    const dp=e.target.closest && e.target.closest('.datepick');
    if(dp){ e.preventDefault(); abrir(dp); return; }
    if(pop && !pop.hidden && !(e.target.closest && e.target.closest('.cal'))){ cerrar(); }
  });
  window.addEventListener('resize', cerrar);
})();

/* ---------- arranque ---------- */
function init(){
  const now = new Date(); now.setMinutes(now.getMinutes()-now.getTimezoneOffset());
  if($('admFecha')) $('admFecha').value = now.toISOString().slice(0,16);
  repararPerms();
  const u = sesionUser();
  if(u){ entrar(u); } else { mostrarGate(); }
}
/* El módulo de nube (nube.js) descarga primero los datos compartidos y luego
   llama a window.__startApp() para mostrar el inicio de sesión (usuario + clave).
   Si no hay nube disponible, la app arranca sola en el siguiente ciclo. */
window.__startApp = init;
setTimeout(function(){ if(!window.__cloudWillBoot){ init(); } }, 0);
