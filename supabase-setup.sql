-- =====================================================================
-- NEXUSMED · Configuración de Supabase (pegar en SQL Editor y ejecutar)
-- =====================================================================
-- Crea una tabla única "app_state" donde se guarda el estado compartido
-- de la clínica (admisiones, notas, EPS, parámetros de la IPS y perfiles
-- de usuario). Todos los dispositivos de la MISMA clínica comparten estos
-- datos.
--
-- IMPORTANTE: en esta versión el inicio de sesión es con USUARIO y
-- CONTRASEÑA dentro de la app (no con correo / Supabase Auth). Por eso la
-- app se conecta con la "clave publicable" (rol anon) y estas políticas
-- permiten el acceso al rol anon. Sin esto, la app NO podría leer ni
-- guardar en la nube.
-- ---------------------------------------------------------------------

-- 1) Tabla de estado compartido
create table if not exists public.app_state (
  key        text primary key,
  data       jsonb,
  updated_at timestamptz not null default now()
);

-- 2) Activar Row Level Security
alter table public.app_state enable row level security;

-- 3) Políticas: permitir acceso al rol anon (clave publicable) y también
--    a authenticated. Borra políticas viejas por si ya existían.
drop policy if exists "nxm_select" on public.app_state;
drop policy if exists "nxm_insert" on public.app_state;
drop policy if exists "nxm_update" on public.app_state;
drop policy if exists "nxm_delete" on public.app_state;

create policy "nxm_select" on public.app_state
  for select to anon, authenticated using (true);
create policy "nxm_insert" on public.app_state
  for insert to anon, authenticated with check (true);
create policy "nxm_update" on public.app_state
  for update to anon, authenticated using (true) with check (true);
create policy "nxm_delete" on public.app_state
  for delete to anon, authenticated using (true);

-- 4) Habilitar "Realtime" para que los cambios se vean en vivo en
--    todos los dispositivos. (Si da error porque ya está agregada,
--    puede ignorarlo.)
do $$
begin
  begin
    alter publication supabase_realtime add table public.app_state;
  exception when duplicate_object then null;
  end;
end $$;

-- Listo. No necesita crear más tablas: la app usa esta sola.
-- Las contraseñas de los usuarios se guardan (cifradas) dentro de la
-- misma tabla app_state, en la clave "usuarios", y la app las valida
-- al iniciar sesión con usuario y contraseña.
