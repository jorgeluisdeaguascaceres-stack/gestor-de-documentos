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

  /* Descarga el estado compartido de la nube hacia este dispositivo */
  function syncPull(cb){
    if(!sb){ if(cb) cb(); return; }
    pulling = true;
    sb.from('app_state').select('key,data').then(function(res){
      try{
        if(res && res.data){
          res.data.forEach(function(row){
            if(SYNC_KEYS.indexOf(row.key) >= 0 && row.data != null){
              try{ store.setSilent(row.key, row.data); }catch(e){}
            }
          });
        }
      }finally{ pulling = false; if(cb) cb(); }
    }, function(){ pulling = false; if(cb) cb(); });
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
    if(!sb){ bootApp(); return; }   /* sin librería de nube: arranca en modo local */
    /* 1) descargar datos compartidos  2) escuchar cambios en vivo  3) iniciar la app */
    syncPull(function(){ suscribirRealtime(); bootApp(); });
    /* seguro: si la descarga tarda demasiado, arranca de todos modos a los 6 s */
    setTimeout(bootApp, 6000);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', arranque);
  }else{
    arranque();
  }
})();
