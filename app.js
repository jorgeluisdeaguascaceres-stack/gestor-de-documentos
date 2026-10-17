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
function flash(el, texto, tipo){ el.textContent=texto; el.className='msg'+(tipo?(' '+tipo):''); if(texto){ setTimeout(()=>{ if(el.textContent===texto){el.textContent='';el.className='msg';} }, 4000); } }

/* ============================================================
   AUTENTICACIÓN Y PERMISOS
   ============================================================ */
const ROLES = { maestro:'Maestro', admin:'Administrador', medico:'Médico', administrativo:'Administrativo' };
const MODS = ['admision','registro','consulta','config'];
function defaultPerms(rol){
  switch(rol){
    case 'maestro': return {admision:true, registro:true, consulta:true, config:true, editar:true};
    case 'admin':   return {admision:true, registro:true, consulta:true, config:false, editar:true};
    case 'medico':  return {admision:false, registro:true, consulta:true, config:false, editar:false};
    case 'administrativo': return {admision:true, registro:false, consulta:true, config:false, editar:false};
    default: return {admision:false, registro:false, consulta:false, config:false, editar:false};
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
function can(mod){ return !!(CURRENT && CURRENT.perms && CURRENT.perms[mod]); }

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
  renderAdm(); renderReg(); loadIps(); refreshPacList();
  if(can('config')) renderUsr();
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
   MÓDULO 2 · REGISTRO MÉDICO (historias / notas de evolución)
   ============================================================ */
function refreshPacList(){
  const dl=$('pacList'); if(!dl) return; dl.innerHTML='';
  const vistos=new Set();
  store.get('admisiones',[]).forEach(a=>{ const n=nombrePaciente(a); if(n && !vistos.has(n)){ vistos.add(n); const o=document.createElement('option'); o.value=n; dl.appendChild(o); } });
}
function renderReg(){
  const q=($('regQ').value||'').toLowerCase().trim();
  const ft=$('regFiltro').value;
  let lista=store.get('notas',[]);
  if(ft) lista=lista.filter(n=> n.tipo===ft);
  if(q) lista=lista.filter(n=> (n.pac+' '+n.doc+' '+n.medico).toLowerCase().includes(q));
  const tb=$('regTb'); tb.innerHTML='';
  $('regCount').textContent = lista.length + (lista.length===1?' registro':' registros');
  if(!lista.length){ const tr=document.createElement('tr'); const c=td('Sin notas registradas.'); c.colSpan=6; c.className='vacio'; tr.appendChild(c); tb.appendChild(tr); return; }
  lista.slice().reverse().forEach(n=>{
    const tr=document.createElement('tr');
    tr.appendChild(td(fmtFecha(n.fecha)));
    tr.appendChild(td(n.pac));
    tr.appendChild(td(n.doc));
    const tt=td(''); const p=document.createElement('span'); p.className='pill cy'; p.textContent=n.tipo; tt.textContent=''; tt.appendChild(p); tr.appendChild(tt);
    tr.appendChild(td(n.medico));
    const acc=document.createElement('td'); acc.className='right';
    const bv=document.createElement('button'); bv.className='btn ghost mini'; bv.textContent='Ver';
    bv.addEventListener('click', ()=> alert(n.tipo+'\nPaciente: '+n.pac+'\nDocumento: '+n.doc+'\nMédico: '+(n.medico||'—')+'\nFecha: '+fmtFecha(n.fecha)+'\n\n'+(n.texto||'(sin contenido)')));
    const bd=document.createElement('button'); bd.className='btn del mini'; bd.textContent='Eliminar'; bd.style.marginLeft='6px';
    bd.addEventListener('click', ()=>{ if(confirm('¿Eliminar esta nota?')){ store.set('notas', store.get('notas',[]).filter(x=>x.id!==n.id)); renderReg(); } });
    acc.appendChild(bv); acc.appendChild(bd); tr.appendChild(acc);
    tb.appendChild(tr);
  });
}
$('regQ').addEventListener('input', renderReg);
$('regFiltro').addEventListener('change', renderReg);
/* modal nueva nota */
function abrirNota(){ $('formNota').reset(); flash($('ntMsg'),''); $('ovNota').hidden=false; }
function cerrarNota(){ $('ovNota').hidden=true; }
$('regNueva').addEventListener('click', abrirNota);
$('notaX').addEventListener('click', cerrarNota);
$('notaCancel').addEventListener('click', cerrarNota);
$('ovNota').addEventListener('click', (e)=>{ if(e.target===$('ovNota')) cerrarNota(); });
$('formNota').addEventListener('submit', (e)=>{
  e.preventDefault();
  const pac=$('ntPac').value.trim(), doc=$('ntDoc').value.trim();
  if(!pac||!doc){ flash($('ntMsg'),'Indica paciente y documento.','err'); return; }
  const nota={ id:uid(), fecha:new Date().toISOString(), tipo:$('ntTipo').value, pac, doc, medico:$('ntMed').value.trim(), texto:$('ntTexto').value.trim() };
  const l=store.get('notas',[]); l.push(nota); store.set('notas',l);
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
    d.setFontSize(10); d.setTextColor(25,35,48);
    const txt = (n.texto&&n.texto.trim()) ? n.texto : '(sin contenido)';
    const lineas = d.splitTextToSize(txt, ancho);
    lineas.forEach(ln=>{ nl(14); d.text(ln, ml, y); y+=14; });
    y+=8; nl(16); d.setDrawColor(210,220,230); d.setLineWidth(0.5); d.line(ml,y,pw-mr,y); y+=16;
  });
  // pie con numeración
  const tot=d.internal.getNumberOfPages();
  for(let p=1;p<=tot;p++){ d.setPage(p); d.setFontSize(8); d.setTextColor(150,160,172); d.text('NEXUSMED · documento generado localmente · página '+p+' de '+tot, ml, ph-28); }
  const safe=(nombre||'paciente').replace(/[^a-z0-9]+/gi,'_').replace(/^_+|_+$/g,'').toLowerCase();
  d.save('consulta_'+(doc||'doc')+'_'+safe+'.pdf');
  flash($('csMsg'),'PDF generado.','ok');
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
  $('usrCount').textContent = lista.length + (lista.length===1?' usuario':' usuarios');
  lista.forEach(u=>{
    const tr=document.createElement('tr');
    tr.appendChild(td(u.usuario));
    const rc=document.createElement('td'); const rp=document.createElement('span'); rp.className='pill '+((u.rol==='maestro'||u.rol==='admin')?'cy':'gr'); rp.textContent=ROLES[u.rol]||u.rol; rc.appendChild(rp); tr.appendChild(rc);
    MODS.forEach(m=>{
      const c=document.createElement('td'); c.className='csw';
      const lab=document.createElement('label'); lab.className='sw';
      const inp=document.createElement('input'); inp.type='checkbox'; inp.checked=!!(u.perms&&u.perms[m]);
      if(u.rol==='maestro') inp.disabled=true; /* el maestro conserva todos los permisos */
      inp.addEventListener('change', ()=>{ const l=usuarios(); const t=l.find(x=>x.id===u.id); if(!t) return; if(!t.perms) t.perms={}; t.perms[m]=inp.checked; setUsuarios(l); });
      const tk=document.createElement('span'); tk.className='track';
      lab.appendChild(inp); lab.appendChild(tk); c.appendChild(lab); tr.appendChild(c);
    });
    /* columna Editar admisiones (permiso independiente) */
    const ce=document.createElement('td'); ce.className='csw';
    const le=document.createElement('label'); le.className='sw';
    const ie=document.createElement('input'); ie.type='checkbox'; ie.checked=!!(u.perms&&u.perms.editar);
    if(u.rol==='maestro') ie.disabled=true;
    ie.addEventListener('change', ()=>{ const l=usuarios(); const t=l.find(x=>x.id===u.id); if(!t) return; if(!t.perms) t.perms={}; t.perms.editar=ie.checked; setUsuarios(l); });
    const tke=document.createElement('span'); tke.className='track';
    le.appendChild(ie); le.appendChild(tke); ce.appendChild(le);
    const ec=document.createElement('td'); const ep=document.createElement('span'); ep.className='pill '+(u.activo?'ok':'off'); ep.textContent=u.activo?'Activo':'Inactivo'; ec.appendChild(ep); tr.appendChild(ce); tr.appendChild(ec);
    tr.appendChild(td(u.ultimo?fmtFecha(u.ultimo):'Nunca'));
    const acc=document.createElement('td'); acc.className='right';
    if(u.rol==='maestro'){
      const b=document.createElement('span'); b.className='pill gr'; b.textContent='Tú (maestro)'; acc.appendChild(b);
    } else {
      const bt=document.createElement('button'); bt.className='btn ghost mini'; bt.textContent=u.activo?'Desactivar':'Activar';
      bt.addEventListener('click', ()=>{ const l=usuarios(); const t=l.find(x=>x.id===u.id); if(t){t.activo=!t.activo; setUsuarios(l); renderUsr();} });
      const bd=document.createElement('button'); bd.className='btn del mini'; bd.textContent='Eliminar'; bd.style.marginLeft='6px';
      bd.addEventListener('click', ()=>{ if(confirm('¿Eliminar el usuario '+u.usuario+'?')){ setUsuarios(usuarios().filter(x=>x.id!==u.id)); renderUsr(); } });
      acc.appendChild(bt); acc.appendChild(bd);
    }
    tr.appendChild(acc); tb.appendChild(tr);
  });
}
$('formUsr').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const usuario=$('nuUsuario').value.trim().toLowerCase(), clave=$('nuClave').value, rol=$('nuRol').value;
  if(!/^[a-z0-9._-]{3,}$/.test(usuario)){ flash($('usrMsg'),'Usuario inválido (letras, números, punto, guion).','err'); return; }
  if(clave.length<8 || !/[a-z]/i.test(clave) || !/[0-9]/.test(clave)){ flash($('usrMsg'),'La contraseña debe tener 8+ caracteres con letras y números.','err'); return; }
  if(usuarios().some(x=>x.usuario===usuario)){ flash($('usrMsg'),'Ese usuario ya existe.','err'); return; }
  const h = await hashPwd(clave);
  const nuevo = { id:uid(), usuario, rol, activo:true, ultimo:null, salt:h.salt, hash:h.hash, perms:defaultPerms(rol) };
  const l=usuarios(); l.push(nuevo); setUsuarios(l);
  $('nuUsuario').value=''; $('nuClave').value='';
  flash($('usrMsg'),'Usuario creado con permisos de '+(ROLES[rol]||rol)+'.','ok'); renderUsr();
});

/* ---------- arranque ---------- */
function init(){
  const now = new Date(); now.setMinutes(now.getMinutes()-now.getTimezoneOffset());
  $('admFecha').value = now.toISOString().slice(0,16);
  const u = sesionUser();
  if(u){ entrar(u); } else { mostrarGate(); }
}
init();
