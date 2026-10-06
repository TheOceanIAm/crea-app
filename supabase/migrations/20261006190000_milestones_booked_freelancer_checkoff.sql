-- Keep in sync with crea-services/supabase/migrations/20261006190000_milestones_booked_freelancer_checkoff.sql
-- Booked freelancers can check off milestones on jobs they were hired for.
-- Company team keeps full edit. Insert and delete stay company-only.
-- A trigger stops booked crew from changing title, pay, or any other field.

create or replace function public.crea_current_user_booked_on_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.crea_current_user_accepted_on_job(p_job_id)
    or exists (
      select 1
      from public.projects p
      where p.job_id = p_job_id
        and p.freelancer_id = auth.uid()
    )
    or exists (
      select 1
      from public.projects p
      inner join public.project_members pm on pm.project_id = p.id
      where p.job_id = p_job_id
        and pm.profile_id = auth.uid()
    );
$$;

comment on function public.crea_current_user_booked_on_job(uuid) is
  'True if the current user is accepted on the job, the project lead freelancer, or a project member.';

revoke all on function public.crea_current_user_booked_on_job(uuid) from public;
grant execute on function public.crea_current_user_booked_on_job(uuid) to authenticated;

create or replace function public.crea_milestones_guard_booked_checkoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_payload jsonb := to_jsonb(old);
  new_payload jsonb := to_jsonb(new);
begin
  -- Service role (invoice / pay routes) has no auth.uid().
  if auth.uid() is null then
    return new;
  end if;

  if public.crea_rls_job_company_team_can_manage_milestones(old.job_id) then
    return new;
  end if;

  if not public.crea_current_user_booked_on_job(old.job_id) then
    raise exception 'Not allowed to update this milestone';
  end if;

  if new.status is distinct from old.status
     and new.status not in ('pending', 'in_progress', 'completed') then
    raise exception 'Invalid milestone status';
  end if;

  old_payload := old_payload - 'status' - 'deliverables_done' - 'updated_at';
  new_payload := new_payload - 'status' - 'deliverables_done' - 'updated_at';
  if old_payload is distinct from new_payload then
    raise exception 'Booked crew can only check milestones off';
  end if;

  return new;
end;
$$;

comment on function public.crea_milestones_guard_booked_checkoff() is
  'Booked freelancers may change milestone status and deliverables_done only.';

drop trigger if exists trg_milestones_booked_checkoff on public.milestones;
create trigger trg_milestones_booked_checkoff
  before update on public.milestones
  for each row
  execute function public.crea_milestones_guard_booked_checkoff();

drop policy if exists "milestones_update_booked_checkoff" on public.milestones;
create policy "milestones_update_booked_checkoff"
  on public.milestones for update to authenticated
  using (public.crea_current_user_booked_on_job(job_id))
  with check (public.crea_current_user_booked_on_job(job_id));

notify pgrst, 'reload schema';
