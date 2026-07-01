-- Platform user counts: exclude beta testers and CEO freelancer ids (matches web CEO dashboard).

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
    ),
    'new_users', (
      select count(*)::int
      from public.profiles pr
      inner join auth.users u on u.id = pr.id
      where public._ceo_is_platform_profile(pr.id, pr.role::text, pr.beta_invite)
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

create or replace function public._ceo_normalize_freelancer_plan(raw text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(raw, ''))) in ('pro', 'premium') then 'pro'
    else 'free'
  end;
$$;

create or replace function public._ceo_normalize_company_plan(raw text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(raw, ''))) in ('pro', 'agency', 'business', 'enterprise', 'professional') then 'pro'
    else 'free'
  end;
$$;

create or replace function public.ceo_mrr_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  freelancer_free int := 0;
  freelancer_pro int := 0;
  company_free int := 0;
  company_pro int := 0;
  r record;
begin
  if not public._ceo_is_caller() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  for r in
    select fp.id, public._ceo_normalize_freelancer_plan(fp.plan_tier::text) as tier
    from public.freelancer_profiles fp
    left join public.profiles p on p.id = fp.id
    where coalesce(p.beta_invite, false) = false
      and fp.id not in (
        '168f1204-bb53-4aba-95b6-5f94ccb6f197'::uuid,
        '9be43cb1-0842-491b-8574-fba23079f16c'::uuid
      )
  loop
    if r.tier = 'pro' then
      freelancer_pro := freelancer_pro + 1;
    else
      freelancer_free := freelancer_free + 1;
    end if;
  end loop;

  for r in
    select public._ceo_normalize_company_plan(cp.subscription_plan::text) as tier
    from public.company_profiles cp
    left join public.profiles p on p.id = cp.id
    where coalesce(p.beta_invite, false) = false
  loop
    if r.tier = 'pro' then
      company_pro := company_pro + 1;
    else
      company_free := company_free + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'freelancerFree', freelancer_free,
    'freelancerPro', freelancer_pro,
    'companyFree', company_free,
    'companyPro', company_pro
  );
end;
$$;

revoke all on function public.ceo_mrr_snapshot() from public;
grant execute on function public.ceo_mrr_snapshot() to authenticated;
