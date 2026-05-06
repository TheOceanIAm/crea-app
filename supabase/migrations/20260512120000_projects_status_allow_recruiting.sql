-- jobs.project_status uses recruiting | active | completed; projects.status must allow the same values.

alter table public.projects drop constraint if exists projects_status_check;

alter table public.projects
add constraint projects_status_check
check (
  status in (
    'recruiting',
    'active',
    'in_progress',
    'completed',
    'archived',
    'paused',
    'cancelled'
  )
);

comment on constraint projects_status_check on public.projects is
  'Workspace phase: mirrors jobs.project_status where linked; legacy paused/cancelled kept for older rows.';
