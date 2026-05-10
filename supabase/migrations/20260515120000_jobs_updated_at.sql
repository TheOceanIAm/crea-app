-- public.jobs: add updated_at (app lists / orders by it; e.g. workspace-projects, booking modals used .order('updated_at')).
alter table public.jobs
  add column if not exists updated_at timestamptz;

update public.jobs j
set updated_at = coalesce(j.created_at, now())
where j.updated_at is null;

alter table public.jobs
  alter column updated_at set default now();

create or replace function public.trg_jobs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_jobs_set_updated_at on public.jobs;
create trigger trg_jobs_set_updated_at
  before update on public.jobs
  for each row
  execute function public.trg_jobs_set_updated_at();

comment on column public.jobs.updated_at is 'Row last-updated time; kept in sync by trg_jobs_set_updated_at.';
