-- Internal project budget: targets + expense lines. Visible only to projects.company_id (RLS).
-- Crew/production burn is computed client-side from project_members shoot days × profile day_rate_amount.

create table if not exists public.project_budget_plans (
  project_id uuid primary key references public.projects (id) on delete cascade,
  currency text not null default 'EUR',
  total_budget numeric,
  production_budget numeric,
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.project_budget_plans is
  'Company-only budget caps per project; freelancers have no SELECT via RLS.';

create table if not exists public.project_budget_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  label text not null default '',
  planned_amount numeric not null default 0,
  spent_amount numeric not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists project_budget_lines_project_idx on public.project_budget_lines (project_id);

alter table public.project_budget_plans enable row level security;
alter table public.project_budget_lines enable row level security;

drop policy if exists "project_budget_plans_company_select" on public.project_budget_plans;
create policy "project_budget_plans_company_select" on public.project_budget_plans
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_budget_plans.project_id and p.company_id = auth.uid()
    )
  );

drop policy if exists "project_budget_plans_company_insert" on public.project_budget_plans;
create policy "project_budget_plans_company_insert" on public.project_budget_plans
  for insert to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_budget_plans.project_id and p.company_id = auth.uid()
    )
  );

drop policy if exists "project_budget_plans_company_update" on public.project_budget_plans;
create policy "project_budget_plans_company_update" on public.project_budget_plans
  for update to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_budget_plans.project_id and p.company_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_budget_plans.project_id and p.company_id = auth.uid()
    )
  );

drop policy if exists "project_budget_plans_company_delete" on public.project_budget_plans;
create policy "project_budget_plans_company_delete" on public.project_budget_plans
  for delete to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_budget_plans.project_id and p.company_id = auth.uid()
    )
  );

drop policy if exists "project_budget_lines_company_select" on public.project_budget_lines;
create policy "project_budget_lines_company_select" on public.project_budget_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_budget_lines.project_id and p.company_id = auth.uid()
    )
  );

drop policy if exists "project_budget_lines_company_insert" on public.project_budget_lines;
create policy "project_budget_lines_company_insert" on public.project_budget_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_budget_lines.project_id and p.company_id = auth.uid()
    )
  );

drop policy if exists "project_budget_lines_company_update" on public.project_budget_lines;
create policy "project_budget_lines_company_update" on public.project_budget_lines
  for update to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_budget_lines.project_id and p.company_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_budget_lines.project_id and p.company_id = auth.uid()
    )
  );

drop policy if exists "project_budget_lines_company_delete" on public.project_budget_lines;
create policy "project_budget_lines_company_delete" on public.project_budget_lines
  for delete to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_budget_lines.project_id and p.company_id = auth.uid()
    )
  );

create or replace function public.touch_project_budget_plans_updated()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_project_budget_plans_touch on public.project_budget_plans;
create trigger trg_project_budget_plans_touch
  before update on public.project_budget_plans
  for each row
  execute function public.touch_project_budget_plans_updated();
