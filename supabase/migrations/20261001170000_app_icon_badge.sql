-- Home-screen icon badge. Pushes increment it; the app writes the real unread total when open.
-- Keep in sync with crea-services/supabase/migrations/20261001170000_app_icon_badge.sql

alter table public.profiles
  add column if not exists app_icon_badge integer not null default 0;

comment on column public.profiles.app_icon_badge is
  'Last iOS/Android home-screen badge. Remote pushes increment it; the app overwrites it with unread DMs + alerts.';

create or replace function public.bump_app_icon_badge(p_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_badge integer;
begin
  update public.profiles
  set app_icon_badge = least(coalesce(app_icon_badge, 0) + 1, 99)
  where id = p_profile_id
  returning app_icon_badge into next_badge;
  return coalesce(next_badge, 1);
end;
$$;

revoke all on function public.bump_app_icon_badge(uuid) from public;
revoke all on function public.bump_app_icon_badge(uuid) from anon;
revoke all on function public.bump_app_icon_badge(uuid) from authenticated;
grant execute on function public.bump_app_icon_badge(uuid) to service_role;
