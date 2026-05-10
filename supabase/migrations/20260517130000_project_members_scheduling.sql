-- Per–crew-member production window (inclusive dates) → public freelancer calendar busy days.
-- Aggregated in profile_share_public alongside projects.scheduling_* for the lead.

alter table public.project_members
  add column if not exists scheduling_start_date date,
  add column if not exists scheduling_end_date date;

comment on column public.project_members.scheduling_start_date is
  'Inclusive first booked day for this member; merged into profile_share_public.calendar_busy_dates when project is active.';
comment on column public.project_members.scheduling_end_date is
  'Inclusive last booked day for this member; must be >= scheduling_start_date when both set.';

drop policy if exists "project_members_update_lead" on public.project_members;
create policy "project_members_update_lead" on public.project_members
  for update to authenticated
  using (
    exists (
      select 1 from public.projects proj
      where proj.id = project_id
        and (auth.uid() = proj.company_id or auth.uid() = proj.freelancer_id)
    )
  )
  with check (
    exists (
      select 1 from public.projects proj
      where proj.id = project_id
        and (auth.uid() = proj.company_id or auth.uid() = proj.freelancer_id)
    )
  );

comment on policy "project_members_update_lead" on public.project_members is
  'Company or lead freelancer may update member rows (incl. crew scheduling dates).';

-- ---------------------------------------------------------------------------
-- profile_share_public: union busy days from lead projects row + per-member ranges
-- ---------------------------------------------------------------------------
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
