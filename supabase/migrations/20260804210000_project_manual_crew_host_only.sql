-- Manual / external crew: only the project host (company) may write.
-- Day rates are readable only via project_manual_crew_readable (host sees amounts; others get null).

create or replace function public.crea_user_is_project_host(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and p.company_id = auth.uid()
    )
    or exists (
      select 1
      from public.projects p
      inner join public.company_members cm on cm.company_id = p.company_id
      where p.id = p_project_id
        and cm.profile_id = auth.uid()
        and cm.status = 'active'
    );
$$;

comment on function public.crea_user_is_project_host(uuid) is
  'True when auth.uid() is projects.company_id or an active company_members row for that company.';

grant execute on function public.crea_user_is_project_host(uuid) to authenticated;

drop policy if exists "project_manual_crew_insert" on public.project_manual_crew;
create policy "project_manual_crew_insert"
  on public.project_manual_crew for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.crea_user_is_project_host(project_id)
  );

drop policy if exists "project_manual_crew_update" on public.project_manual_crew;
create policy "project_manual_crew_update"
  on public.project_manual_crew for update to authenticated
  using (public.crea_user_is_project_host(project_id))
  with check (public.crea_user_is_project_host(project_id));

drop policy if exists "project_manual_crew_delete" on public.project_manual_crew;
create policy "project_manual_crew_delete"
  on public.project_manual_crew for delete to authenticated
  using (public.crea_user_is_project_host(project_id));

-- Owner view (can read rate columns) + explicit membership filter (owner bypasses RLS).
-- security_invoker=false so CASE can read day_rate_* despite column REVOKE on the base table.
create or replace view public.project_manual_crew_readable
with (security_invoker = false)
as
select
  m.id,
  m.project_id,
  m.name,
  m.member_role,
  m.email,
  m.phone,
  m.created_by,
  m.created_at,
  m.updated_at,
  m.works_as,
  m.booked_dates,
  m.scheduling_start_date,
  m.scheduling_end_date,
  case
    when public.crea_user_is_project_host(m.project_id) then m.day_rate_amount
    else null
  end as day_rate_amount,
  case
    when public.crea_user_is_project_host(m.project_id) then m.half_day_rate_amount
    else null
  end as half_day_rate_amount
from public.project_manual_crew m
where public.user_in_project(m.project_id, auth.uid());

comment on view public.project_manual_crew_readable is
  'project_manual_crew for clients; day_rate_* null unless viewer is project host.';

grant select on public.project_manual_crew_readable to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.project_manual_crew_readable from authenticated;

-- All project members can read the directory (RLS: user_in_project).
-- Day rates for non-hosts are masked via project_manual_crew_readable; host-only writes via RLS.
revoke all on table public.project_manual_crew from anon;
grant select, insert, update, delete on table public.project_manual_crew to authenticated;
