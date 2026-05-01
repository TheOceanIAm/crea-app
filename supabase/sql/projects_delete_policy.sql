-- Allow company/lead owner to permanently delete their own projects.
-- Needed for the Workspace Projects "Delete" action.

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects
  for delete using (auth.uid() = company_id or auth.uid() = freelancer_id);
