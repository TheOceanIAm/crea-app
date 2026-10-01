-- Optional project length, including hours (e.g. "4 hours", "2 days").
-- Keep in sync with crea-services/supabase/migrations/20261001180000_jobs_duration.sql

alter table public.jobs
  add column if not exists duration text;

comment on column public.jobs.duration is
  'Project length chosen when the job or workspace is created, such as "6 hours" or "2–5 days".';
