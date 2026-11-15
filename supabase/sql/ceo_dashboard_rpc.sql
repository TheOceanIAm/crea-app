-- CEO dashboard metrics for the mobile app (and web).
-- CEO if profiles.role = 'ceo' OR auth JWT user_metadata/app_metadata.role = 'ceo' (web-only CEO flag).
-- Run in Supabase SQL Editor. For Users / Companies / Revenue screens also run ceo_admin_rpcs.sql.

create or replace function public._ceo_is_platform_profile(p_id uuid, p_role text, p_beta_invite boolean)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_beta_invite, false) = false
    and lower(trim(coalesce(p_role, ''))) in ('freelancer', 'company')
    and not (
      lower(trim(coalesce(p_role, ''))) = 'freelancer'
      and p_id in (
        '168f1204-bb53-4aba-95b6-5f94ccb6f197'::uuid,
        '9be43cb1-0842-491b-8574-fba23079f16c'::uuid
      )
    );
$$;

revoke all on function public._ceo_is_platform_profile(uuid, text, boolean) from public;

create or replace function public.ceo_dashboard_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  is_ceo boolean;
begin
  select
    exists(
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and lower(trim(coalesce(p.role::text, ''))) = 'ceo'
    )
    or lower(trim(coalesce((auth.jwt()->'user_metadata'->>'role'), ''))) = 'ceo'
    or lower(trim(coalesce((auth.jwt()->'user_metadata'->>'user_role'), ''))) = 'ceo'
    or lower(trim(coalesce((auth.jwt()->'app_metadata'->>'role'), ''))) = 'ceo'
  into is_ceo;

  if not is_ceo then
    return jsonb_build_object(
      'ok', false,
      'error', 'forbidden',
      'all_users', 0,
      'new_users', 0,
      'active_jobs', 0,
      'completed_jobs', 0
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'all_users', (
      select count(*)::int
      from public.profiles pr
      inner join auth.users u on u.id = pr.id
      where public._ceo_is_platform_profile(pr.id, pr.role::text, pr.beta_invite)
        and coalesce(pr.is_internal, false) = false
    ),
    'new_users', (
      select count(*)::int
      from public.profiles pr
      inner join auth.users u on u.id = pr.id
      where public._ceo_is_platform_profile(pr.id, pr.role::text, pr.beta_invite)
        and coalesce(pr.is_internal, false) = false
        and u.created_at >= (now() - interval '7 days')
    ),
    'active_jobs', (select count(*)::int from public.jobs where lower(coalesce(status, '')) = 'active'),
    'completed_jobs', (
      select count(*)::int
      from public.jobs
      where lower(coalesce(status, '')) in ('completed', 'closed', 'filled', 'archived')
    )
  );
end;
$$;

revoke all on function public.ceo_dashboard_snapshot() from public;
grant execute on function public.ceo_dashboard_snapshot() to authenticated;
