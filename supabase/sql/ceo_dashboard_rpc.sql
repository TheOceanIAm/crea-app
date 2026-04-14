-- CEO dashboard metrics for the mobile app (and web).
-- CEO if profiles.role = 'ceo' OR auth JWT user_metadata/app_metadata.role = 'ceo' (web-only CEO flag).
-- Run in Supabase SQL Editor. For Users / Companies / Revenue screens also run ceo_admin_rpcs.sql.

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
      'completed_jobs', 0,
      'recent_users', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    -- Match ceo_list_users / web admin: only profiles tied to a real auth user (excludes orphan profile rows).
    'all_users', (
      select count(*)::int
      from public.profiles pr
      inner join auth.users u on u.id = pr.id
    ),
    'new_users', (
      select count(*)::int
      from public.profiles pr
      inner join auth.users u on u.id = pr.id
      where u.created_at >= (now() - interval '7 days')
    ),
    'active_jobs', (select count(*)::int from public.jobs where lower(coalesce(status, '')) = 'active'),
    'completed_jobs', (
      select count(*)::int
      from public.jobs
      where lower(coalesce(status, '')) in ('completed', 'closed', 'filled', 'archived')
    ),
    'recent_users', coalesce(
      (
        select jsonb_agg(x.obj order by x.sort_ts desc)
        from (
          select
            jsonb_build_object(
              'id', pr.id,
              'name', coalesce(pr.name, ''),
              'role', coalesce(pr.role, ''),
              'avatar_url', pr.avatar_url
            ) as obj,
            u.created_at as sort_ts
          from public.profiles pr
          inner join auth.users u on u.id = pr.id
          order by u.created_at desc
          limit 8
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.ceo_dashboard_snapshot() from public;
grant execute on function public.ceo_dashboard_snapshot() to authenticated;
