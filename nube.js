/* ============================================================================
   NEXUSMED · Módulo de nube (sincronización silenciosa)
   --------------------------------------------------------------------------
   OBJETIVO: un SOLO link. El inicio de sesión sigue siendo con USUARIO y
   CONTRASEÑA dentro de la app (NO por correo). La nube (Supabase) solo se usa
   por detrás como almacén compartido: así el maestro crea los usuarios y los
   médicos entran desde cualquier dispositivo con su usuario y contraseña,
   viendo los mismos pacientes y notas.

   La app se conecta con la CLAVE PUBLICABLE (rol anon). Esa clave es pública
   (va en el frontend sin problema). La clave secreta NUNCA se pone aquí.
   ========================================================================== */
(function(){
  'use strict';

  // --- Nube de la clínica (compartida por todos los dispositivos) ---
  var DEFAULT_CFG = {
    url:  'https://bfmugufoxxrhagthoecp.supabase.co',
    anon: 'sb_publishable_g7nEnLljj_9LOtvRbayZ-Q_IrhOFVVS'
  };

  // Datos que se comparten entre dispositivos
  var SYNC_KEYS = ['usuarios','admisiones','notas','ips','eps'];

  var $ = function(id){ return document.getElementById(id); };
  var sb = null;          // cliente supabase
  var pulling = false;    // evita bucles al recibir datos de la nube
  var channel = null;

  // Avisa a app.js que la nube se encargará de arrancar (no arranque solo).
  window.__cloudWillBoot = true;

  function estado(txt, cls){
    var e = $('nubeEstado'); if(!e) return;
    if(txt === null){ e.style.display = 'none'; return; }
    e.style.display = '';
    e.textContent = txt;
    e.className = 'nube-estado ' + (cls || 'nube-check');
  }

  function crearCliente(c){
    if(!window.supabase || !window.supabase.createClient) return null;
    try{
      return window.supabase.createClient(c.url, c.anon, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    }catch(e){ return null; }
  }

  /* ---------- sincronización ---------- */
  // Trae todo el estado compartido de la nube a este dispositivo.
  function syncPull(cb){
    if(!sb){ if(cb) cb(); return; }
    pulling = true;
    sb.from('app_state').select('key,data').then(function(res){
      var presentes = {};
      try{
        if(res && res.data && typeof store !== 'undefined'){
          res.data.forEach(function(row){
            if(SYNC_KEYS.indexOf(row.key) >= 0 && row.data != null){
              store.setSilent(row.key, row.data);
              presentes[row.key] = true;
            }
          });
        }
      }finally{
        pulling = false;
        sembrarNube(presentes);
        if(cb) cb();
      }
    }, function(){ pulling = false; if(cb) cb(); });
  }

  // Si la nube aún no tiene datos de una clave pero este dispositivo SÍ
  // (p. ej. los pacientes/notas creados anoche en local), los sube a la nube
  // para que se vean en los demás dispositivos. No pisa datos ya existentes.
  function sembrarNube(presentes){
    if(!sb || typeof store === 'undefined') return;
    SYNC_KEYS.forEach(function(key){
      if(presentes[key]) return;              // la nube ya tiene esta clave
      var val = store.get(key, null);
      var vacio = (val == null) || (Array.isArray(val) && val.length === 0);
      if(!vacio){
        try{
          sb.from('app_state').upsert({ key: key, data: val }, { onConflict: 'key' })
            .then(function(){}, function(){});
        }catch(e){}
      }
    });
  }

  // Empuja un cambio local a la nube (lo llama store.set automáticamente).
  window.cloudPush = function(key, value){
    if(!sb || pulling) return;
    if(SYNC_KEYS.indexOf(key) < 0) return;
    try{
      sb.from('app_state').upsert({ key: key, data: value }, { onConflict: 'key' })
        .then(function(){}, function(){});
    }catch(e){}
  };

  // Escucha cambios de otros dispositivos y los aplica en vivo.
  function suscribirRealtime(){
    if(!sb || channel) return;
    try{
      channel = sb.channel('app_state_rt')
        .on('postgres_changes', { event:'*', schema:'public', table:'app_state' }, function(payload){
          var row = payload && payload.new;
          if(row && SYNC_KEYS.indexOf(row.key) >= 0 && row.data != null && typeof store !== 'undefined'){
            pulling = true;
            try{ store.setSilent(row.key, row.data); } finally { pulling = false; }
            // Si ya hay sesión: refresca datos sin mover al usuario de pantalla.
            if(typeof window.__refreshData === 'function'){ try{ window.__refreshData(); }catch(e){} }
            // Si aún está en el inicio de sesión: actualiza el gate (maestro ya creado).
            if(typeof window.__refreshGate === 'function'){ try{ window.__refreshGate(); }catch(e){} }
          }
        })
        .subscribe();
    }catch(e){}
  }
  window.__cloudSubscribe = suscribirRealtime;

  /* ---------- arranque ---------- */
  function iniciarApp(){
    // Muestra el inicio de sesión de SIEMPRE (usuario + contraseña).
    if(typeof window.__startApp === 'function'){
      try{ window.__startApp(); }catch(e){}
    }
    // Deja escuchando los cambios en vivo de otros dispositivos.
    suscribirRealtime();
  }

  function arranque(){
    estado('Conectando…', 'nube-check');
    sb = crearCliente(DEFAULT_CFG);
    if(!sb){
      // Sin internet o sin componente de nube: la app funciona igual (local).
      estado('Sin conexión (modo local)', 'nube-off');
      iniciarApp();
      return;
    }
    // Trae primero los datos compartidos y luego muestra el inicio de sesión.
    var listo = false;
    var finalizar = function(ok){
      if(listo) return; listo = true;
      estado(ok ? null : 'Sin conexión (modo local)', ok ? '' : 'nube-off');
      iniciarApp();
    };
    // Red de seguridad: si la nube tarda demasiado, arranca igual con lo local.
    setTimeout(function(){ finalizar(false); }, 6000);
    syncPull(function(){ finalizar(true); });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', arranque);
  }else{
    arranque();
  }
})();
