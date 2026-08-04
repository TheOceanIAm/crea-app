-- Restore directory read for all project members (fixes "permission denied for table project_manual_crew").
-- Host-only writes remain via project_manual_crew_* RLS policies.
-- Prefer project_manual_crew_readable in clients so day rates stay masked for non-hosts.

revoke all on table public.project_manual_crew from anon;
grant select, insert, update, delete on table public.project_manual_crew to authenticated;

grant select on table public.project_manual_crew_readable to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.project_manual_crew_readable from authenticated;
