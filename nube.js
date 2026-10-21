/* ============================================================================
   NEXUSMED · Nube compartida (automática)
   ----------------------------------------------------------------------------
   La app se conecta SOLA a Supabase para GUARDAR y COMPARTIR los datos entre
   todos los dispositivos (celular, tablet, PC). Nadie tiene que configurar ni
   pegar nada.

   El inicio de sesión sigue siendo con USUARIO y CONTRASEÑA (no correo): se
   valida contra la lista de usuarios que se sincroniza desde la nube. O sea,
   los usuarios que el maestro crea en Configuraciones sirven en todos los
   dispositivos.

   Nota: la "clave publicable" (publishable) es pública y segura de dejar aquí;
   la "clave secreta" (secret) NUNCA debe ir en esta app.
   ========================================================================== */
(function(){
  'use strict';

  /* ---- Conexión fija a TU nube de 1 GB (no hay que configurar nada) ---- */
  var DEFAULT_URL = 'https://bfmugufoxxrhagthoecp.supabase.co';
  var DEFAULT_KEY = 'sb_publishable_g7nEnLljj_9LOtvRbayZ-Q_IrhOFVVS';

  var SYNC_KEYS = ['usuarios','admisiones','notas','ips','eps','visitas'];
  var sb = null, pulling = false, channel = null, booted = false;

  /* ---- Indicador visible de estado de la nube en la pantalla de inicio ---- */
  function setNube(cls, texto){
    var e = document.getElementById('nubeEstado');
    if(!e) return;
    /* Cuando la nube funciona, no se muestra ningún aviso: pantalla limpia. */
    if(cls === 'nube-ok'){ e.hidden = true; e.textContent = ''; return; }
    e.hidden = false;
    e.className = 'nube-estado ' + cls;
    e.textContent = texto;
  }

  /* Avisar a app.js que la nube hará el arranque (descarga primero, login después) */
  window.__cloudWillBoot = true;

  /* arranca la app una sola vez (muestra el login usuario/contraseña) */
  function bootApp(){
    if(booted) return; booted = true;
    if(typeof window.__startApp === 'function') window.__startApp();
  }

  function crearCliente(){
    if(!window.supabase || !window.supabase.createClient) return null;
    try{
      return window.supabase.createClient(DEFAULT_URL, DEFAULT_KEY, {
        auth: { persistSession:false, autoRefreshToken:false }
      });
    }catch(e){ return null; }
  }

  /* Sube local -> nube cuando la nube NO tiene todavía ese dato (siembra).
     Sirve para que, al activar la nube, el usuario maestro (y demás datos)
     que ya existían en ESTE dispositivo suban solos y los vean los demás. */
  function sembrarEnNube(cloudKeys){
    if(!sb) return;
    SYNC_KEYS.forEach(function(key){
      if(cloudKeys.indexOf(key) >= 0) return;   /* la nube ya lo tiene: no tocar */
      var local = null;
      try{ local = store.get(key, null); }catch(e){ local = null; }
      var vacio = (local == null) ||
                  (Array.isArray(local) && local.length === 0) ||
                  (typeof local === 'object' && !Array.isArray(local) && Object.keys(local).length === 0);
      if(vacio) return;
      try{
        sb.from('app_state')
          .upsert({ key:key, data:local, updated_at:new Date().toISOString() }, { onConflict:'key' })
          .then(function(){}, function(){});
      }catch(e){}
    });
  }

  /* Descarga el estado compartido de la nube hacia este dispositivo */
  function syncPull(cb){
    if(!sb){ if(cb) cb(); return; }
    pulling = true;
    sb.from('app_state').select('key,data').then(function(res){
      var cloudKeys = [];
      try{
        if(res && res.error){
          setNube('nube-off', 'Aún no se comparten los usuarios entre dispositivos. Falta activar la nube una sola vez.');
        }else if(res && res.data){
          res.data.forEach(function(row){
            if(SYNC_KEYS.indexOf(row.key) >= 0 && row.data != null){
              cloudKeys.push(row.key);
              try{ store.setSilent(row.key, row.data); }catch(e){}
            }
          });
          setNube('nube-ok', '☁ Nube conectada · los usuarios y datos se comparten entre todos los dispositivos.');
        }
      }finally{
        pulling = false;
        /* la nube respondió bien: sembrar lo que falte desde este dispositivo */
        if(!(res && res.error)){ try{ sembrarEnNube(cloudKeys); }catch(e){} }
        if(cb) cb();
      }
    }, function(){
      setNube('nube-off', 'Sin conexión a internet con la nube. Verifique su conexión.');
      pulling = false; if(cb) cb();
    });
  }

  /* Sube un cambio local a la nube (lo llama store.set automáticamente) */
  window.cloudPush = function(key, value){
    if(!sb || pulling) return;
    if(SYNC_KEYS.indexOf(key) < 0) return;
    try{
      sb.from('app_state')
        .upsert({ key:key, data:value, updated_at:new Date().toISOString() }, { onConflict:'key' })
        .then(function(){}, function(){});
    }catch(e){}
  };

  /* Escucha cambios en vivo de otros dispositivos y refresca la pantalla */
  function suscribirRealtime(){
    if(!sb || channel) return;
    try{
      channel = sb.channel('app_state_rt')
        .on('postgres_changes', { event:'*', schema:'public', table:'app_state' }, function(payload){
          var row = payload && payload.new;
          if(row && SYNC_KEYS.indexOf(row.key) >= 0 && row.data != null){
            pulling = true;
            try{ store.setSilent(row.key, row.data); } finally { pulling = false; }
            try{
              if(typeof CURRENT !== 'undefined' && CURRENT && typeof entrar === 'function'){ entrar(CURRENT); }
              else if(typeof window.__refreshGate === 'function'){ window.__refreshGate(); }
            }catch(e){}
          }
        })
        .subscribe();
    }catch(e){}
  }

  /* Oculta los botones viejos de "conectar a la nube" / login por correo:
     ahora la nube es automática y el acceso es con usuario y contraseña. */
  function limpiarUInube(){
    ['gatePie','gNube'].forEach(function(id){
      var e = document.getElementById(id); if(e) e.hidden = true;
    });
  }

  function arranque(){
    limpiarUInube();
    sb = crearCliente();
    if(!sb){ setNube('nube-off', 'Este dispositivo trabaja solo. Falta activar la nube para compartir usuarios y datos.'); bootApp(); return; }   /* sin librería de nube: arranca en modo local */
    /* 1) descargar datos compartidos  2) escuchar cambios en vivo  3) iniciar la app */
    syncPull(function(){ suscribirRealtime(); bootApp(); if(typeof window.__refreshGate === 'function') window.__refreshGate(); });
    /* seguro: si la descarga tarda demasiado, arranca de todos modos a los 6 s */
    setTimeout(bootApp, 6000);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', arranque);
  }else{
    arranque();
  }
})();
