-- Assignee on production tasks: crew member (profile / manual crew) or a typed name.
alter table public.production_tasks
  add column if not exists assignee_name text not null default '',
  add column if not exists assignee_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists assignee_manual_crew_id uuid references public.project_manual_crew (id) on delete set null;

create index if not exists production_tasks_assignee_profile_idx
  on public.production_tasks (assignee_profile_id)
  where assignee_profile_id is not null;

create index if not exists production_tasks_assignee_manual_idx
  on public.production_tasks (assignee_manual_crew_id)
  where assignee_manual_crew_id is not null;
