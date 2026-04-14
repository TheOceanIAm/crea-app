-- Platform-wide settings (CEO only via RPC). Run before ceo_admin_rpcs.sql adds the read/patch functions.
-- Quick fix if the app cannot find ceo_get_platform_settings: run ceo_platform_settings_install.sql (includes table + RPCs + schema reload).

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

comment on table public.platform_settings is 'Single-row platform flags; read/write only through ceo_get_platform_settings / ceo_patch_platform_settings.';
