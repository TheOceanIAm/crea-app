-- Keep in sync with crea-services/supabase/migrations/20260803120000_milestones_priority.sql
-- Delivery urgency for workspace milestones (orthogonal to workflow status).

alter table public.milestones
  add column if not exists priority text;

update public.milestones
set priority = 'p3'
where priority is null;

alter table public.milestones
  alter column priority set default 'p3';

alter table public.milestones
  alter column priority set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'milestones_priority_check'
      and conrelid = 'public.milestones'::regclass
  ) then
    alter table public.milestones
      add constraint milestones_priority_check
      check (priority in ('p1', 'p2', 'p3'));
  end if;
end $$;

comment on column public.milestones.priority is
  'Delivery urgency: p1 (high/red), p2 (medium/yellow), p3 (low/green). Orthogonal to status.';
