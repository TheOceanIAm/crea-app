-- Run in Supabase SQL Editor if ceo_list_users / ceo_list_companies already exist.
-- Removes login email from JSON responses (CEO search by email still works server-side).
-- Keeps _ceo_is_caller gate — only CEO receives lists.
-- Name order matches the app profile: stored name, company name, signup metadata, then the email label.

create or replace function public.crea_display_name_from_email(email text)
returns text
language sql
immutable
as $$
  select case
    when position('@' in coalesce(email, '')) = 0 then null
    when btrim(split_part(email, '@', 1)) ~ '^[0-9]+$' then null
    else public.crea_meaningful_profile_name(
      initcap(btrim(regexp_replace(split_part(email, '@', 1), '[._+-]+', ' ', 'g')))
    )
  end;
$$;

revoke all on function public.crea_display_name_from_email(text) from public;
revoke all on function public.crea_display_name_from_email(text) from anon, authenticated;

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
              'name', coalesce(
                public.crea_meaningful_profile_name(pr.name),
                public.crea_meaningful_profile_name(cp.company_name),
                public.crea_profile_name_from_auth_meta(u.raw_user_meta_data),
                public.crea_display_name_from_email(u.email),
                ''
              ),
              'role', coalesce(pr.role, ''),
              'avatar_url', pr.avatar_url,
              'headline', coalesce(pr.headline, ''),
              'is_internal', coalesce(pr.is_internal, false),
              'beta_invite', coalesce(pr.beta_invite, false)
            ) as obj,
            u.created_at as sort_ts
          from public.profiles pr
          inner join auth.users u on u.id = pr.id
          left join public.company_profiles cp on cp.id = pr.id
          where lower(trim(coalesce(pr.role, ''))) in ('freelancer', 'company')
            -- User pool lists every real account, including internal and beta-invite ones (flagged below);
            -- the CEO metrics keep using _ceo_is_platform_profile and skip them.
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

create or replace function public.ceo_list_companies(p_search text default '', p_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  lim int := least(greatest(coalesce(p_limit, 500), 1), 2000);
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
              'name', coalesce(
                public.crea_meaningful_profile_name(pr.name),
                public.crea_meaningful_profile_name(cp.company_name),
                public.crea_profile_name_from_auth_meta(u.raw_user_meta_data),
                public.crea_display_name_from_email(u.email),
                ''
              ),
              'role', coalesce(pr.role, ''),
              'avatar_url', pr.avatar_url,
              'headline', coalesce(pr.headline, ''),
              'location', coalesce(pr.location, '')
            ) as obj,
            u.created_at as sort_ts
          from public.profiles pr
          inner join auth.users u on u.id = pr.id
          left join public.company_profiles cp on cp.id = pr.id
          where lower(trim(coalesce(pr.role, ''))) = 'company'
            and pr.id not in (
              'b6dc97ee-80ab-4cd4-b4af-496def9888f9'::uuid,
              '03a7b802-0f40-47cb-b094-a97769d3d234'::uuid
            )
            and (
              q = ''
              or pr.name ilike '%' || q || '%'
              or coalesce(cp.company_name, '') ilike '%' || q || '%'
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
