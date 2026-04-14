-- Let company accounts create and manage their own job rows (run if inserts from the app fail with RLS).
-- Requires public.jobs with company_id uuid referencing profiles.

alter table public.jobs enable row level security;

drop policy if exists "jobs_select_public" on public.jobs;
create policy "jobs_select_public" on public.jobs
  for select using (true);

drop policy if exists "jobs_insert_own_company" on public.jobs;
create policy "jobs_insert_own_company" on public.jobs
  for insert with check (auth.uid() = company_id);

drop policy if exists "jobs_update_own_company" on public.jobs;
create policy "jobs_update_own_company" on public.jobs
  for update using (auth.uid() = company_id);

drop policy if exists "jobs_delete_own_company" on public.jobs;
create policy "jobs_delete_own_company" on public.jobs
  for delete using (auth.uid() = company_id);
