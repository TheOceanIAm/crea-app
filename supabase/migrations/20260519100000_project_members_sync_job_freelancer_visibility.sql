-- Freelancers read marketplace jobs via job_freelancer_visibility (synced from job_applications only).
-- Booking / crew on project_members never inserted there → My Projects empty + jobs SELECT blocked.
-- Mirror visibility whenever a non-company member is added to a project that has job_id.

create or replace function public.trg_project_members_sync_job_freelancer_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  jid uuid;
  comp uuid;
begin
  select p.job_id, p.company_id into jid, comp
  from public.projects p
  where p.id = new.project_id;

  if jid is null then
    return new;
  end if;

  if new.profile_id is not distinct from comp then
    return new;
  end if;

  insert into public.job_freelancer_visibility (job_id, freelancer_id)
  values (jid, new.profile_id)
  on conflict (job_id, freelancer_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_project_members_sync_job_freelancer_visibility on public.project_members;
create trigger trg_project_members_sync_job_freelancer_visibility
  after insert on public.project_members
  for each row
  execute function public.trg_project_members_sync_job_freelancer_visibility();

comment on function public.trg_project_members_sync_job_freelancer_visibility() is
  'Adds job_freelancer_visibility when a crew/lead member joins a marketplace project (job_id set) so the freelancer can SELECT jobs and see My Projects.';

-- Backfill existing crew/lead rows (idempotent).
insert into public.job_freelancer_visibility (job_id, freelancer_id)
select p.job_id, pm.profile_id
from public.project_members pm
inner join public.projects p on p.id = pm.project_id
where p.job_id is not null
  and pm.profile_id is distinct from p.company_id
on conflict (job_id, freelancer_id) do nothing;
