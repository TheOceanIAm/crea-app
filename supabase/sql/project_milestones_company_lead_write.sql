-- Only project company or lead freelancer may add/remove milestone rows.
-- All project members keep SELECT + UPDATE (crew can mark steps complete).
-- Run after project_workspace_native.sql.

drop policy if exists "project_milestones_insert" on public.project_milestones;
drop policy if exists "project_milestones_delete" on public.project_milestones;

create policy "project_milestones_insert" on public.project_milestones
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and (p.company_id = auth.uid() or p.freelancer_id = auth.uid())
    )
  );

create policy "project_milestones_delete" on public.project_milestones
  for delete using (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and (p.company_id = auth.uid() or p.freelancer_id = auth.uid())
    )
  );
