-- Call sheet + daily wrap: only the project host (projects.company_id) may write.
-- Crew still reads via production_days_select (user_in_project).
-- Keep in sync with crea-app/supabase/migrations/20260921150000_production_days_host_only_update.sql

drop policy if exists "production_days_update" on public.production_days;
create policy "production_days_update" on public.production_days
  for update using (
    public._ceo_is_caller()
    or exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.company_id = auth.uid()
    )
  )
  with check (
    public._ceo_is_caller()
    or exists (
      select 1 from public.projects p
      where p.id = project_id
        and p.company_id = auth.uid()
    )
  );

comment on policy "production_days_update" on public.production_days is
  'Host (projects.company_id) or CEO can update call sheet / wrap; all members may still select.';
