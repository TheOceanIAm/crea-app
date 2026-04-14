-- CEO admin lists, revenue & platform settings (mobile + web). Caller is CEO if profiles.role = 'ceo' or JWT metadata.role = 'ceo'.
-- Requires public.invoices if you use invoice revenue / list (same shape as app inserts).
-- Platform settings: run supabase/sql/platform_settings.sql before the ceo_get/patch_platform_settings functions below.
-- Run in Supabase SQL Editor after ceo_dashboard_rpc.sql.

create or replace function public._ceo_is_caller()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists(
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and lower(trim(coalesce(p.role::text, ''))) = 'ceo'
    )
    or lower(trim(coalesce((auth.jwt()->'user_metadata'->>'role'), ''))) = 'ceo'
    or lower(trim(coalesce((auth.jwt()->'user_metadata'->>'user_role'), ''))) = 'ceo'
    or lower(trim(coalesce((auth.jwt()->'app_metadata'->>'role'), ''))) = 'ceo';
$$;

revoke all on function public._ceo_is_caller() from public;

-- ---------------------------------------------------------------------------
-- All profiles (search by name or email)
-- ---------------------------------------------------------------------------
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
              'headline', coalesce(pr.headline, ''),
              'email', u.email::text
            ) as obj,
            u.created_at as sort_ts
          from public.profiles pr
          inner join auth.users u on u.id = pr.id
          where
            q = ''
            or pr.name ilike '%' || q || '%'
            or u.email::text ilike '%' || q || '%'
          order by u.created_at desc
          limit lim
        ) x
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.ceo_list_users(text, int) from public;
grant execute on function public.ceo_list_users(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Company accounts only
-- ---------------------------------------------------------------------------
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
              'location', coalesce(pr.location, ''),
              'email', u.email::text
            ) as obj,
            u.created_at as sort_ts
          from public.profiles pr
          inner join auth.users u on u.id = pr.id
          where lower(trim(coalesce(pr.role, ''))) = 'company'
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

revoke all on function public.ceo_list_companies(text, int) from public;
grant execute on function public.ceo_list_companies(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Revenue aggregates (invoices)
-- ---------------------------------------------------------------------------
create or replace function public.ceo_revenue_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  paid numeric;
  outstanding numeric;
  inv_count int;
  cur text;
  volume_ex_cancelled numeric;
  paid_cnt int;
  open_cnt int;
  cancelled_sum numeric;
  by_status jsonb;
  month_paid numeric;
  has_created_at boolean;
  has_currency boolean;
begin
  if not public._ceo_is_caller() then
    return jsonb_build_object(
      'ok', false,
      'invoice_count', 0,
      'paid_total', 0,
      'outstanding_total', 0,
      'currency', 'EUR'
    );
  end if;

  select count(*)::int into inv_count from public.invoices;

  select coalesce(sum(amount), 0) into paid
  from public.invoices
  where lower(trim(coalesce(status, ''))) = 'paid';

  select coalesce(sum(amount), 0) into outstanding
  from public.invoices
  where lower(trim(coalesce(status, ''))) in ('pending', 'draft', 'overdue');

  select coalesce(sum(amount), 0) into volume_ex_cancelled
  from public.invoices
  where lower(trim(coalesce(status, ''))) <> 'cancelled';

  select count(*)::int into paid_cnt
  from public.invoices
  where lower(trim(coalesce(status, ''))) = 'paid';

  select count(*)::int into open_cnt
  from public.invoices
  where lower(trim(coalesce(status, ''))) in ('pending', 'draft', 'overdue');

  select coalesce(sum(amount), 0) into cancelled_sum
  from public.invoices
  where lower(trim(coalesce(status, ''))) = 'cancelled';

  select coalesce(
    (
      select jsonb_object_agg(q.st, jsonb_build_object('count', q.c, 'sum', q.s))
      from (
        select
          lower(trim(coalesce(status, ''))) as st,
          count(*)::int as c,
          coalesce(sum(amount), 0) as s
        from public.invoices
        group by 1
      ) q
    ),
    '{}'::jsonb
  )
  into by_status;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'created_at'
  )
  into has_created_at;

  if has_created_at then
    select coalesce(sum(amount), 0) into month_paid
    from public.invoices
    where lower(trim(coalesce(status, ''))) = 'paid'
      and created_at >= date_trunc('month', current_timestamp);
  else
    month_paid := null;
  end if;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'currency'
  )
  into has_currency;

  if has_currency then
    execute $cur$
      select coalesce(
        (
          select c.currency
          from public.invoices c
          where c.currency is not null and trim(c.currency::text) <> ''
          limit 1
        ),
        'EUR'
      )
    $cur$ into cur;
  else
    cur := 'EUR';
  end if;

  return jsonb_build_object(
    'ok', true,
    'invoice_count', coalesce(inv_count, 0),
    'paid_total', paid,
    'outstanding_total', outstanding,
    'currency', cur,
    'volume_ex_cancelled', coalesce(volume_ex_cancelled, 0),
    'paid_count', coalesce(paid_cnt, 0),
    'open_count', coalesce(open_cnt, 0),
    'cancelled_total', coalesce(cancelled_sum, 0),
    'by_status', by_status,
    'has_created_at', has_created_at,
    'month_paid_total', case when has_created_at then month_paid else null end
  );
exception
  when undefined_table then
    return jsonb_build_object(
      'ok', false,
      'error', 'no_invoices_table',
      'invoice_count', 0,
      'paid_total', 0,
      'outstanding_total', 0,
      'currency', 'EUR'
    );
end;
$$;

revoke all on function public.ceo_revenue_snapshot() from public;
grant execute on function public.ceo_revenue_snapshot() to authenticated;

-- ---------------------------------------------------------------------------
-- Recent invoices (read-only list)
-- ---------------------------------------------------------------------------
create or replace function public.ceo_list_invoices(p_limit int default 40)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  lim int := least(greatest(coalesce(p_limit, 40), 1), 100);
  has_currency boolean;
  payload jsonb;
begin
  if not public._ceo_is_caller() then
    return jsonb_build_object('ok', false, 'invoices', '[]'::jsonb);
  end if;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'currency'
  )
  into has_currency;

  if has_currency then
    execute $list$
      select jsonb_build_object(
        'ok', true,
        'invoices', coalesce(
          (
            select jsonb_agg(y.obj order by y.sort_id desc)
            from (
              select
                jsonb_build_object(
                  'id', i.id,
                  'title', coalesce(i.title, ''),
                  'amount', i.amount,
                  'currency', coalesce(i.currency, 'EUR'),
                  'status', coalesce(i.status, ''),
                  'due_date', i.due_date,
                  'company_name', coalesce(cp.name, ''),
                  'freelancer_name', coalesce(fp.name, '')
                ) as obj,
                i.id as sort_id
              from public.invoices i
              left join public.profiles cp on cp.id = i.company_id
              left join public.profiles fp on fp.id = i.freelancer_id
              order by i.id desc
              limit $1
            ) y
          ),
          '[]'::jsonb
        )
      )
    $list$ using lim into payload;
  else
    execute $list$
      select jsonb_build_object(
        'ok', true,
        'invoices', coalesce(
          (
            select jsonb_agg(y.obj order by y.sort_id desc)
            from (
              select
                jsonb_build_object(
                  'id', i.id,
                  'title', coalesce(i.title, ''),
                  'amount', i.amount,
                  'currency', 'EUR',
                  'status', coalesce(i.status, ''),
                  'due_date', i.due_date,
                  'company_name', coalesce(cp.name, ''),
                  'freelancer_name', coalesce(fp.name, '')
                ) as obj,
                i.id as sort_id
              from public.invoices i
              left join public.profiles cp on cp.id = i.company_id
              left join public.profiles fp on fp.id = i.freelancer_id
              order by i.id desc
              limit $1
            ) y
          ),
          '[]'::jsonb
        )
      )
    $list$ using lim into payload;
  end if;

  return payload;
exception
  when undefined_table then
    return jsonb_build_object('ok', false, 'invoices', '[]'::jsonb, 'error', 'no_invoices_table');
end;
$$;

revoke all on function public.ceo_list_invoices(int) from public;
grant execute on function public.ceo_list_invoices(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Single invoice (CEO read-only; bypasses RLS if table is restricted)
-- ---------------------------------------------------------------------------
create or replace function public.ceo_get_invoice(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  row jsonb;
begin
  if not public._ceo_is_caller() then
    return null;
  end if;

  select to_jsonb(i) into row from public.invoices i where i.id = p_id limit 1;
  return row;
exception
  when undefined_table then
    return null;
end;
$$;

revoke all on function public.ceo_get_invoice(uuid) from public;
grant execute on function public.ceo_get_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Subscription revenue (Abo): gross/net totals + breakdown by audience & tier
-- ---------------------------------------------------------------------------
create or replace function public.ceo_subscription_revenue_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  has_revenue_table boolean;
  has_sub_tier_col boolean;
  gross_total numeric := 0;
  net_total numeric := 0;
  vat_total numeric := 0;
  entry_count int := 0;
  month_gross numeric := 0;
  month_net numeric := 0;
  cur text := 'EUR';
  by_role jsonb;
  plan_dist jsonb;
begin
  if not public._ceo_is_caller() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select exists(
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'subscription_revenue_entries'
  )
  into has_revenue_table;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'subscription_tier'
  )
  into has_sub_tier_col;

  if has_sub_tier_col then
    select coalesce(
      (
        select jsonb_object_agg(y.aud, y.tiers_obj)
        from (
          select
            x.aud,
            jsonb_object_agg(x.tier, x.cnt) as tiers_obj
          from (
            select
              case
                when lower(trim(p.role::text)) = 'company' then 'company'
                when lower(trim(p.role::text)) = 'freelancer' then 'freelancer'
              end as aud,
              lower(trim(coalesce(p.subscription_tier, 'starter'))) as tier,
              count(*)::int as cnt
            from public.profiles p
            where lower(trim(coalesce(p.role::text, ''))) in ('company', 'freelancer')
            group by 1, 2
          ) x
          where x.aud is not null
          group by x.aud
        ) y
      ),
      '{}'::jsonb
    )
    into plan_dist;
  else
    plan_dist := '{}'::jsonb;
  end if;

  if not has_revenue_table then
    return jsonb_build_object(
      'ok', true,
      'has_revenue_table', false,
      'currency', 'EUR',
      'gross_total', 0,
      'net_total', 0,
      'vat_total', 0,
      'entry_count', 0,
      'month_gross', null,
      'month_net', null,
      'by_audience', '{}'::jsonb,
      'plan_distribution', plan_dist,
      'hint',
      'Run supabase/sql/subscription_revenue.sql, then insert rows (Stripe webhook or SQL). Stored amounts: gross incl. VAT, net after VAT.'
    );
  end if;

  select
    coalesce(sum(amount_gross), 0),
    coalesce(sum(amount_net), 0),
    count(*)::int
  into gross_total, net_total, entry_count
  from public.subscription_revenue_entries;

  vat_total := gross_total - net_total;

  select coalesce(sum(amount_gross), 0), coalesce(sum(amount_net), 0)
  into month_gross, month_net
  from public.subscription_revenue_entries
  where booked_at >= date_trunc('month', current_timestamp);

  select coalesce(
    (
      select e.currency
      from public.subscription_revenue_entries e
      group by e.currency
      order by count(*) desc
      limit 1
    ),
    'EUR'
  )
  into cur;

  select coalesce(
    (
      with agg as (
        select
          e.audience,
          lower(trim(coalesce(e.tier, 'starter'))) as tier,
          coalesce(sum(e.amount_gross), 0) as g,
          coalesce(sum(e.amount_net), 0) as n,
          count(*)::int as c
        from public.subscription_revenue_entries e
        group by 1, 2
      ),
      by_aud as (
        select
          a.audience,
          coalesce(sum(a.g), 0) as gross,
          coalesce(sum(a.n), 0) as net,
          coalesce(sum(a.c), 0) as cnt,
          coalesce(
            jsonb_object_agg(
              a.tier,
              jsonb_build_object(
                'gross', a.g,
                'net', a.n,
                'count', a.c
              )
            ),
            '{}'::jsonb
          ) as by_tier
        from agg a
        group by a.audience
      )
      select jsonb_object_agg(
        b.audience,
        jsonb_build_object(
          'gross', b.gross,
          'net', b.net,
          'count', b.cnt,
          'by_tier', b.by_tier
        )
      )
      from by_aud b
    ),
    '{}'::jsonb
  )
  into by_role;

  return jsonb_build_object(
    'ok', true,
    'has_revenue_table', true,
    'currency', cur,
    'gross_total', gross_total,
    'net_total', net_total,
    'vat_total', vat_total,
    'entry_count', entry_count,
    'month_gross', month_gross,
    'month_net', month_net,
    'by_audience', by_role,
    'plan_distribution', plan_dist
  );
exception
  when undefined_table then
    return jsonb_build_object(
      'ok', true,
      'has_revenue_table', false,
      'currency', 'EUR',
      'gross_total', 0,
      'net_total', 0,
      'vat_total', 0,
      'entry_count', 0,
      'month_gross', null,
      'month_net', null,
      'by_audience', '{}'::jsonb,
      'plan_distribution', coalesce(plan_dist, '{}'::jsonb),
      'hint', 'Create subscription_revenue_entries (subscription_revenue.sql).'
    );
end;
$$;

revoke all on function public.ceo_subscription_revenue_snapshot() from public;
grant execute on function public.ceo_subscription_revenue_snapshot() to authenticated;

-- ---------------------------------------------------------------------------
-- Platform settings (maintenance, registration, VAT display, announcement)
-- Requires public.platform_settings — run supabase/sql/platform_settings.sql first.
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
      'hint', 'Run supabase/sql/platform_settings.sql in the SQL Editor.'
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
      'hint', 'Run supabase/sql/platform_settings.sql in the SQL Editor.'
    );
end;
$$;

revoke all on function public.ceo_patch_platform_settings(jsonb) from public;
grant execute on function public.ceo_patch_platform_settings(jsonb) to authenticated;
