-- Optional delivery deadline (date + time) for workspace checklist milestones.
alter table public.project_milestones
  add column if not exists scheduled_at timestamptz;

comment on column public.project_milestones.scheduled_at is
  'Optional delivery / handoff date and time for this milestone (shown in app + web workspace).';
