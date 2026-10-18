/* ============================================================================
   NEXUSMED · Módulo de nube (opcional)
   Conecta la app a Supabase para ver los datos desde cualquier dispositivo
   con internet e iniciar sesión real con correo + contraseña.
   Si no se configura, la app sigue funcionando en modo local (sin internet).
   ========================================================================== */
(function(){
  'use strict';

  var $ = function(id){ return document.getElementById(id); };
  var CFG_KEY = 'nxm_cloud_cfg';
  var SYNC_KEYS = ['usuarios','admisiones','notas','ips','eps'];
  var sb = null;          // cliente supabase
  var cfg = null;         // {url, anon}
  var pulling = false;    // evita bucles al recibir datos de la nube
  var channel = null;

  /* ---------- utilidades de UI ---------- */
  function msg(el, text, cls){
    if(!el) return; el.textContent = text || '';
    el.className = 'msg' + (cls ? ' '+cls : '');
  }
  function show(id, on){ var e=$(id); if(e) e.hidden = !on; }

  function leerCfg(){
    try{ return JSON.parse(localStorage.getItem(CFG_KEY)); }catch(e){ return null; }
  }
  function guardarCfg(c){ localStorage.setItem(CFG_KEY, JSON.stringify(c)); }
  function borrarCfg(){ localStorage.removeItem(CFG_KEY); }

  function crearCliente(c){
    if(!window.supabase || !window.supabase.createClient) return null;
    return window.supabase.createClient(c.url, c.anon, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }

  /* ---------- paneles del gate ---------- */
  function mostrarGateNube(vista){
    // oculta el gate local y muestra el de nube
    ['gLogin','gAlta','gCambio'].forEach(function(id){ show(id, false); });
    var gate = $('gate'); if(gate) gate.hidden = false;
    show('gatePie', false);
    show('gNube', true);
    show('nbLogin', vista==='login');
    show('nbRegistro', vista==='registro');
    show('nbConfig', vista==='config');
  }
  function mostrarGateLocal(){
    show('gNube', false);
    show('gatePie', true);
    if(typeof mostrarGateLocalOrig === 'function') mostrarGateLocalOrig();
  }

  /* ---------- sincronización ---------- */
  function syncPull(cb){
    if(!sb){ if(cb) cb(); return; }
    pulling = true;
    sb.from('app_state').select('key,data').then(function(res){
      try{
        if(res && res.data){
          res.data.forEach(function(row){
            if(SYNC_KEYS.indexOf(row.key) >= 0 && row.data != null){
              store.setSilent(row.key, row.data);
            }
          });
        }
      }finally{
        pulling = false;
        if(cb) cb();
      }
    }, function(){ pulling = false; if(cb) cb(); });
  }

  // empuja un cambio local a la nube (lo llama store.set automáticamente)
  window.cloudPush = function(key, value){
    if(!sb || pulling) return;
    if(SYNC_KEYS.indexOf(key) < 0) return;
    sb.from('app_state').upsert({ key: key, data: value }, { onConflict: 'key' })
      .then(function(){}, function(){});
  };

  function suscribirRealtime(){
    if(!sb || channel) return;
    try{
      channel = sb.channel('app_state_rt')
        .on('postgres_changes', { event:'*', schema:'public', table:'app_state' }, function(payload){
          var row = payload && payload.new;
          if(row && SYNC_KEYS.indexOf(row.key) >= 0 && row.data != null){
            pulling = true;
            try{ store.setSilent(row.key, row.data); } finally { pulling = false; }
            // refresca la vista actual si hay sesión iniciada
            if(window.CURRENT && typeof window.entrar === 'function'){
              try{ window.entrar(window.CURRENT); }catch(e){}
            }
          }
        })
        .subscribe();
    }catch(e){}
  }

  /* ---------- resolución de perfil del usuario que inicia sesión ---------- */
  function uidLocal(){
    return (typeof window.uid === 'function') ? window.uid()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2,8));
  }

  // dado el email autenticado, devuelve (y crea si hace falta) su perfil local
  function resolverPerfil(email, nombre){
    var lista = (typeof window.usuarios === 'function') ? window.usuarios() : [];
    var existente = lista.find(function(u){
      return (u.email && u.email.toLowerCase() === email.toLowerCase())
          || (u.usuario && u.usuario.toLowerCase() === email.toLowerCase());
    });
    if(existente){
      existente.ultimo = new Date().toISOString();
      window.setUsuarios(lista);
      return existente;
    }
    // no existe: el primero es maestro; los demás, médico por defecto
    var hayMaestro = lista.some(function(u){ return u.rol === 'maestro'; });
    var rol = (lista.length === 0 || !hayMaestro) ? 'maestro' : 'medico';
    var perfil = {
      id: uidLocal(),
      usuario: email,
      email: email,
      nombre: nombre || email.split('@')[0],
      doc: '', registro: '', especialidad: 'General', firma: '',
      rol: rol, activo: true, ultimo: new Date().toISOString(),
      perms: window.defaultPerms(rol)
    };
    lista.push(perfil);
    window.setUsuarios(lista); // esto sí se empuja a la nube
    return perfil;
  }

  function iniciarSesionApp(email, nombre){
    syncPull(function(){
      var perfil = resolverPerfil(email, nombre);
      // marca la sesión local (solo este dispositivo)
      store.setSilent('sesion', { usuario: perfil.usuario, ts: Date.now() });
      suscribirRealtime();
      if(typeof window.entrar === 'function') window.entrar(perfil);
    });
  }

  /* ---------- acciones de autenticación ---------- */
  function cloudLogin(email, pass, cb){
    if(!sb){ cb('No hay conexión configurada.'); return; }
    sb.auth.signInWithPassword({ email: email, password: pass }).then(function(res){
      if(res.error){ cb(traducirError(res.error.message)); return; }
      cb(null);
    }, function(){ cb('No se pudo conectar. Revise su internet.'); });
  }

  function cloudSignup(email, pass, nombre, cb){
    if(!sb){ cb('No hay conexión configurada.'); return; }
    sb.auth.signUp({ email: email, password: pass }).then(function(res){
      if(res.error){ cb(traducirError(res.error.message)); return; }
      // intenta iniciar sesión de inmediato (si no se exige confirmación por correo)
      sb.auth.signInWithPassword({ email: email, password: pass }).then(function(r2){
        if(r2.error){
          cb('__CONFIRMAR__'); // requiere confirmación por correo
          return;
        }
        cb(null);
      }, function(){ cb('__CONFIRMAR__'); });
    }, function(){ cb('No se pudo conectar. Revise su internet.'); });
  }

  function traducirError(m){
    m = (m||'').toLowerCase();
    if(m.indexOf('invalid login') >= 0) return 'Correo o contraseña incorrectos.';
    if(m.indexOf('already registered') >= 0) return 'Ese correo ya tiene una cuenta.';
    if(m.indexOf('password') >= 0) return 'La contraseña debe tener al menos 6 caracteres.';
    if(m.indexOf('email') >= 0) return 'Correo electrónico inválido.';
    return 'No se pudo completar la operación.';
  }

  /* ---------- sobrescribe salir/mostrarGate en modo nube ---------- */
  var salirLocal = window.salir;
  var mostrarGateLocalOrig = window.mostrarGate;
  window.salir = function(){
    if(sb){
      store.setSilent('sesion', null);
      window.CURRENT = null;
      try{ sb.auth.signOut(); }catch(e){}
      mostrarGateNube('login');
    }else if(typeof salirLocal === 'function'){
      salirLocal();
    }
  };

  window.mostrarGate = function(){
    if(sb){ mostrarGateNube('login'); }
    else if(typeof mostrarGateLocalOrig === 'function'){ mostrarGateLocalOrig(); }
  };

  /* ---------- conexión de eventos de la interfaz ---------- */
  function conectarUI(){
    // enlaces para cambiar entre modo local y modo nube
    if($('btnIrNube')) $('btnIrNube').addEventListener('click', function(){
      if(!cfg){ mostrarGateNube('config'); } else { mostrarGateNube('login'); }
    });
    if($('btnModoLocal')) $('btnModoLocal').addEventListener('click', function(){
      mostrarGateLocal();
    });
    if($('btnConfigNube')) $('btnConfigNube').addEventListener('click', function(){
      if(cfg){ $('ncUrl').value = cfg.url; $('ncAnon').value = cfg.anon; }
      mostrarGateNube('config');
    });
    if($('btnIrRegistro')) $('btnIrRegistro').addEventListener('click', function(){
      mostrarGateNube('registro');
    });
    if($('btnVolverCloudLogin')) $('btnVolverCloudLogin').addEventListener('click', function(){
      mostrarGateNube('login');
    });
    if($('btnVerCl')) $('btnVerCl').addEventListener('click', function(){
      var i=$('clPass'); i.type = i.type==='password'?'text':'password';
    });

    // probar conexión
    if($('btnNubeProbar')) $('btnNubeProbar').addEventListener('click', function(){
      var url=$('ncUrl').value.trim(), anon=$('ncAnon').value.trim();
      if(!/^https:\/\/.+\.supabase\.co\/?$/.test(url)){ msg($('ncMsg'),'La dirección (Project URL) no parece válida.','err'); return; }
      if(anon.length < 20){ msg($('ncMsg'),'La clave pública (anon) parece incompleta.','err'); return; }
      msg($('ncMsg'),'Probando…','');
      var test = crearCliente({url:url, anon:anon});
      if(!test){ msg($('ncMsg'),'No se pudo cargar el componente de nube.','err'); return; }
      test.from('app_state').select('key').limit(1).then(function(res){
        if(res.error && String(res.error.message||'').toLowerCase().indexOf('relation')>=0){
          msg($('ncMsg'),'Conectó, pero falta crear la tabla. Siga la guía LEEME (script SQL).','err');
        }else{
          msg($('ncMsg'),'✓ Conexión correcta. Ya puede guardar.','ok');
        }
      }, function(){ msg($('ncMsg'),'No se pudo conectar. Revise la dirección y su internet.','err'); });
    });

    // guardar configuración y conectar
    if($('btnNubeGuardar')) $('btnNubeGuardar').addEventListener('click', function(){
      var url=$('ncUrl').value.trim().replace(/\/$/,''), anon=$('ncAnon').value.trim();
      if(!/^https:\/\/.+\.supabase\.co$/.test(url)){ msg($('ncMsg'),'La dirección (Project URL) no parece válida.','err'); return; }
      if(anon.length < 20){ msg($('ncMsg'),'La clave pública (anon) parece incompleta.','err'); return; }
      cfg = { url:url, anon:anon };
      guardarCfg(cfg);
      sb = crearCliente(cfg);
      msg($('ncMsg'),'✓ Guardado. Ahora inicie sesión.','ok');
      mostrarGateNube('login');
    });

    // iniciar sesión en la nube
    if($('formCloudLogin')) $('formCloudLogin').addEventListener('submit', function(e){
      e.preventDefault();
      var email=$('clUser').value.trim(), pass=$('clPass').value;
      if(!email || !pass){ msg($('clMsg'),'Escriba su correo y contraseña.','err'); return; }
      msg($('clMsg'),'Ingresando…','');
      cloudLogin(email, pass, function(err){
        if(err){ msg($('clMsg'), err, 'err'); return; }
        $('clPass').value='';
        iniciarSesionApp(email, '');
      });
    });

    // crear cuenta en la nube
    if($('formCloudSignup')) $('formCloudSignup').addEventListener('submit', function(e){
      e.preventDefault();
      var nombre=$('caNombre').value.trim(), email=$('caUser').value.trim(), pass=$('caPass').value;
      if(!nombre){ msg($('caMsg'),'Escriba su nombre.','err'); return; }
      if(!email){ msg($('caMsg'),'Escriba su correo.','err'); return; }
      if(pass.length < 6){ msg($('caMsg'),'La contraseña debe tener al menos 6 caracteres.','err'); return; }
      msg($('caMsg'),'Creando cuenta…','');
      cloudSignup(email, pass, nombre, function(err){
        if(err === '__CONFIRMAR__'){
          msg($('caMsg'),'Cuenta creada. Revise su correo para confirmarla y luego inicie sesión.','ok');
          setTimeout(function(){ mostrarGateNube('login'); }, 2500);
          return;
        }
        if(err){ msg($('caMsg'), err, 'err'); return; }
        $('caPass').value='';
        iniciarSesionApp(email, nombre);
      });
    });
  }

  /* ---------- arranque ---------- */
  function arranque(){
    conectarUI();
    cfg = leerCfg();
    if(!cfg){ return; } // sin configuración: la app sigue en modo local
    sb = crearCliente(cfg);
    if(!sb){ mostrarGateNube('config'); return; }
    // ¿hay sesión de nube activa? (persistida por supabase)
    sb.auth.getSession().then(function(res){
      var ses = res && res.data && res.data.session;
      if(ses && ses.user){
        var email = ses.user.email;
        var nombre = (ses.user.user_metadata && ses.user.user_metadata.nombre) || '';
        iniciarSesionApp(email, nombre);
      }else{
        mostrarGateNube('login');
      }
    }, function(){ mostrarGateNube('login'); });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', arranque);
  }else{
    arranque();
  }
})();
