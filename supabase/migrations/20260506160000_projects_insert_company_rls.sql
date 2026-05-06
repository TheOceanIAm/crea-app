-- Private workspace: app inserts into public.projects with company_id = auth.uid()
-- (solo: company_id = freelancer_id). crea_app_features.sql defines projects_insert_company;
-- deployments that ran project_workspace_native.sql without the base insert policy have
-- RLS enabled but no INSERT policy → "new row violates row-level security policy".

drop policy if exists "projects_insert_company" on public.projects;
create policy "projects_insert_company" on public.projects
  for insert to authenticated
  with check (auth.uid() = company_id);

comment on policy "projects_insert_company" on public.projects is
  'Project owner (company_id) may create rows; matches solo freelancer workspace inserts.';
