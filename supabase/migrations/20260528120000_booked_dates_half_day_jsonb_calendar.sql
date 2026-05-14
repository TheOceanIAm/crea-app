-- Support booked_dates array entries as ISO strings (full day) or objects {"date","units"}
-- for half-days; public calendar aggregation must read dates from both shapes.

comment on column public.project_members.booked_dates is
  'JSON array per member: ISO date strings (full day) and/or {"date":"YYYY-MM-DD","units":number} for partial days. When non-empty, drives busy dates alongside legacy scheduling_* where applicable.';

create or replace function public.profile_share_public(profile_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select to_jsonb(t) from (
    select
      p.id,
      p.name,
      p.role,
      p.headline,
      p.location,
      p.bio,
      p.avatar_url,
      p.skills,
      p.equipment,
      p.portfolio_website,
      p.portfolio_instagram,
      p.portfolio_linkedin,
      p.portfolio_vimeo,
      p.portfolio_behance,
      p.portfolio_projects,
      p.public_profile_widgets,
      p.day_rate_amount,
      p.half_day_rate_amount,
      p.rates_currency,
      p.availability_calendar,
      p.availability_status,
      p.availability_details,
      coalesce(p.open_to_remote, false) as open_to_remote,
      coalesce(p.open_to_travel, false) as open_to_travel,
      p.years_experience,
      p.public_rating,
      (select count(*)::int from public.projects j where j.freelancer_id = p.id) as workspace_projects_count,
      coalesce(jsonb_array_length(coalesce(p.portfolio_projects, '[]'::jsonb)), 0) as portfolio_items_count,
      (
        select coalesce(
          (
            select jsonb_agg(x.iso order by x.iso)
            from (
              select distinct raw_days.iso
              from (
                select to_char(dr.d, 'YYYY-MM-DD') as iso
                from public.projects pr
                cross join lateral generate_series(
                  pr.scheduling_start_date,
                  pr.scheduling_end_date,
                  interval '1 day'
                ) as dr(d)
                where pr.freelancer_id = p.id
                  and pr.scheduling_start_date is not null
                  and pr.scheduling_end_date is not null
                  and pr.scheduling_end_date >= pr.scheduling_start_date
                  and lower(coalesce(pr.status, '')) in ('active', 'in_progress')
                union all
                select to_char(dr.d, 'YYYY-MM-DD') as iso
                from public.project_members pm
                inner join public.projects pr2 on pr2.id = pm.project_id
                cross join lateral generate_series(
                  pm.scheduling_start_date,
                  pm.scheduling_end_date,
                  interval '1 day'
                ) as dr(d)
                where pm.profile_id = p.id
                  and coalesce(pm.member_role, '') <> 'company'
                  and pm.scheduling_start_date is not null
                  and pm.scheduling_end_date is not null
                  and pm.scheduling_end_date >= pm.scheduling_start_date
                  and lower(coalesce(pr2.status, '')) in ('active', 'in_progress')
                  and (
                    pm.booked_dates is null
                    or jsonb_typeof(pm.booked_dates) <> 'array'
                    or jsonb_array_length(pm.booked_dates) = 0
                  )
                union all
                select cal.iso
                from public.project_members pm
                inner join public.projects pr2 on pr2.id = pm.project_id
                cross join lateral jsonb_array_elements(pm.booked_dates) elem
                cross join lateral (
                  select (
                    case jsonb_typeof(elem)
                      when 'string' then elem #>> '{}'
                      when 'object' then nullif(trim(elem->>'date'), '')
                      else null
                    end
                  ) as iso
                ) cal
                where pm.profile_id = p.id
                  and coalesce(pm.member_role, '') <> 'company'
                  and pm.booked_dates is not null
                  and jsonb_typeof(pm.booked_dates) = 'array'
                  and jsonb_array_length(pm.booked_dates) > 0
                  and cal.iso ~ '^\d{4}-\d{2}-\d{2}$'
                  and lower(coalesce(pr2.status, '')) in ('active', 'in_progress')
              ) raw_days
            ) x
          ),
          '[]'::jsonb
        )
      ) as calendar_busy_dates
    from public.profiles p
    where p.id = profile_id
    limit 1
  ) t;
$$;

revoke all on function public.profile_share_public(uuid) from public;
grant execute on function public.profile_share_public(uuid) to anon, authenticated;
