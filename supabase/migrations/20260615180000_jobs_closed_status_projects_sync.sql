-- Keep in sync with crea-services/supabase/migrations/20260615180000_jobs_closed_status_projects_sync.sql
-- When a company closes a marketplace listing (jobs.status → closed), mirror into linked projects rows
-- so the native app shows the same inactive state as the web “Posted projects” view.

create or replace function public.trg_jobs_mirror_closed_status_to_projects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if old.status is not distinct from new.status then
    return new;
  end if;
  if lower(coalesce(new.status::text, '')) <> 'closed' then
    return new;
  end if;

  target := case
    when lower(coalesce(new.project_status::text, '')) = 'completed' then 'completed'
    else 'cancelled'
  end;

  update public.projects p
  set
    status = target,
    updated_at = now()
  where (p.job_id = new.id or p.id = new.id)
    and p.status is distinct from target;

  return new;
end;
$$;

comment on function public.trg_jobs_mirror_closed_status_to_projects() is
  'jobs.status → closed: mirror cancelled/completed into projects.status for linked workspace rows (web ↔ app).';

drop trigger if exists trg_jobs_mirror_closed_status_to_projects on public.jobs;
create trigger trg_jobs_mirror_closed_status_to_projects
  after update of status on public.jobs
  for each row
  execute function public.trg_jobs_mirror_closed_status_to_projects();

-- Backfill rows that were closed on web before this trigger existed.
update public.projects p
set
  status = case
    when lower(coalesce(j.project_status::text, '')) = 'completed' then 'completed'
    else 'cancelled'
  end,
  updated_at = now()
from public.jobs j
where (p.job_id = j.id or p.id = j.id)
  and lower(coalesce(j.status::text, '')) = 'closed'
  and p.status is distinct from case
    when lower(coalesce(j.project_status::text, '')) = 'completed' then 'completed'
    else 'cancelled'
  end;
