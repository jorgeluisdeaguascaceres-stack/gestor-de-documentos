-- =====================================================================
-- NEXUSMED · Configuración de Supabase (pegar en SQL Editor y ejecutar)
-- =====================================================================
-- Crea una tabla única "app_state" donde se guarda el estado compartido
-- de la clínica (admisiones, notas, EPS, parámetros de la IPS y perfiles
-- de usuario). Todos los profesionales de la MISMA clínica comparten estos
-- datos; solo usuarios con sesión iniciada (autenticados) pueden verlos o
-- modificarlos (Row Level Security activado).
-- ---------------------------------------------------------------------

-- 1) Tabla de estado compartido
create table if not exists public.app_state (
  key        text primary key,
  data       jsonb,
  updated_at timestamptz not null default now()
);

-- 2) Activar Row Level Security
alter table public.app_state enable row level security;

-- 3) Políticas: SOLO usuarios autenticados (con sesión) acceden
--    (una sola clínica compartida). Nadie anónimo puede leer.
drop policy if exists "nxm_select" on public.app_state;
drop policy if exists "nxm_insert" on public.app_state;
drop policy if exists "nxm_update" on public.app_state;
drop policy if exists "nxm_delete" on public.app_state;

create policy "nxm_select" on public.app_state
  for select to authenticated using (true);
create policy "nxm_insert" on public.app_state
  for insert to authenticated with check (true);
create policy "nxm_update" on public.app_state
  for update to authenticated using (true) with check (true);
create policy "nxm_delete" on public.app_state
  for delete to authenticated using (true);

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
-- Las contraseñas de los médicos las maneja Supabase Auth
-- (Authentication), no esta tabla.
