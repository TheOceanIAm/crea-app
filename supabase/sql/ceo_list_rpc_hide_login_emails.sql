-- Run in Supabase SQL Editor if ceo_list_users / ceo_list_companies already exist.
-- Removes login email from JSON responses (CEO search by email still works server-side).
-- Keeps _ceo_is_caller gate — only CEO receives lists.

create or replace function public.ceo_list_users(p_search text default '', p_limit int default 120)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  lim int := least(greatest(coalesce(p_limit, 120), 1), 200);
  q text := trim(coalesce(p_search, ''));
begin
  if not public._ceo_is_caller() then
    return jsonb_build_object('ok', false, 'users', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'users', coalesce(
      (
        select jsonb_agg(x.obj order by x.sort_ts desc)
        from (
          select
            jsonb_build_object(
              'id', pr.id,
              'name', coalesce(pr.name, ''),
              'role', coalesce(pr.role, ''),
              'avatar_url', pr.avatar_url,
              'headline', coalesce(pr.headline, '')
            ) as obj,
            u.created_at as sort_ts
          from public.profiles pr
          inner join auth.users u on u.id = pr.id
          where public._ceo_is_platform_profile(pr.id, pr.role::text, pr.beta_invite)
            and (
            q = ''
            or pr.name ilike '%' || q || '%'
            or u.email::text ilike '%' || q || '%'
            )
          order by u.created_at desc
          limit lim
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.ceo_list_companies(p_search text default '', p_limit int default 120)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  lim int := least(greatest(coalesce(p_limit, 120), 1), 200);
  q text := trim(coalesce(p_search, ''));
begin
  if not public._ceo_is_caller() then
    return jsonb_build_object('ok', false, 'companies', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'companies', coalesce(
      (
        select jsonb_agg(x.obj order by x.sort_ts desc)
        from (
          select
            jsonb_build_object(
              'id', pr.id,
              'name', coalesce(pr.name, ''),
              'role', coalesce(pr.role, ''),
              'avatar_url', pr.avatar_url,
              'headline', coalesce(pr.headline, ''),
              'location', coalesce(pr.location, '')
            ) as obj,
            u.created_at as sort_ts
          from public.profiles pr
          inner join auth.users u on u.id = pr.id
          where lower(trim(coalesce(pr.role, ''))) = 'company'
            and coalesce(pr.beta_invite, false) = false
            and (
              q = ''
              or pr.name ilike '%' || q || '%'
              or u.email::text ilike '%' || q || '%'
              or coalesce(pr.headline, '') ilike '%' || q || '%'
            )
          order by u.created_at desc
          limit lim
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;
