-- One-shot install for CEO → Einstellungen (Platform settings RPCs).
-- Run the whole file in Supabase → SQL Editor if the app says
-- "Could not find the function public.ceo_get_platform_settings …".
-- Keeps the same definitions as platform_settings.sql + ceo_admin_rpcs.sql (platform block).

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.platform_settings (
  id text primary key default 'default' check (id = 'default'),
  maintenance_mode boolean not null default false,
  registration_open boolean not null default true,
  display_vat_rate numeric not null default 0.19,
  announcement_public text,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id) values ('default') on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

comment on table public.platform_settings is 'Single-row platform flags; read/write only through CEO RPCs.';

-- ---------------------------------------------------------------------------
-- RPCs (require public._ceo_is_caller from ceo_admin_rpcs.sql)
-- ---------------------------------------------------------------------------
create or replace function public.ceo_get_platform_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  r record;
begin
  if not public._ceo_is_caller() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into r from public.platform_settings where id = 'default' limit 1;
  if not FOUND then
    insert into public.platform_settings (id) values ('default')
    on conflict (id) do nothing;
    select * into r from public.platform_settings where id = 'default' limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'maintenance_mode', r.maintenance_mode,
    'registration_open', r.registration_open,
    'display_vat_rate', r.display_vat_rate,
    'announcement_public', coalesce(r.announcement_public, ''),
    'updated_at', r.updated_at
  );
exception
  when undefined_table then
    return jsonb_build_object(
      'ok', false,
      'error', 'no_platform_settings_table',
      'hint', 'platform_settings table missing — re-run this file from the top.'
    );
end;
$$;

revoke all on function public.ceo_get_platform_settings() from public;
grant execute on function public.ceo_get_platform_settings() to authenticated;

create or replace function public.ceo_patch_platform_settings(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public._ceo_is_caller() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_patch is null then
    return public.ceo_get_platform_settings();
  end if;

  insert into public.platform_settings (id) values ('default') on conflict (id) do nothing;

  update public.platform_settings s
  set
    maintenance_mode = case
      when p_patch ? 'maintenance_mode' then (p_patch->>'maintenance_mode')::boolean
      else s.maintenance_mode
    end,
    registration_open = case
      when p_patch ? 'registration_open' then (p_patch->>'registration_open')::boolean
      else s.registration_open
    end,
    display_vat_rate = case
      when p_patch ? 'display_vat_rate' then
        greatest(0::numeric, least(1::numeric, (p_patch->>'display_vat_rate')::numeric))
      else s.display_vat_rate
    end,
    announcement_public = case
      when p_patch ? 'announcement_public' then nullif(trim(p_patch->>'announcement_public'), '')
      else s.announcement_public
    end,
    updated_at = now()
  where s.id = 'default'
  returning * into r;

  return jsonb_build_object(
    'ok', true,
    'maintenance_mode', r.maintenance_mode,
    'registration_open', r.registration_open,
    'display_vat_rate', r.display_vat_rate,
    'announcement_public', coalesce(r.announcement_public, ''),
    'updated_at', r.updated_at
  );
exception
  when undefined_table then
    return jsonb_build_object(
      'ok', false,
      'error', 'no_platform_settings_table',
      'hint', 'platform_settings table missing — re-run this file from the top.'
    );
end;
$$;

revoke all on function public.ceo_patch_platform_settings(jsonb) from public;
grant execute on function public.ceo_patch_platform_settings(jsonb) to authenticated;

-- Hint PostgREST to pick up new functions (hosted Supabase usually refreshes quickly).
notify pgrst, 'reload schema';
