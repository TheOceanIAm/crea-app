-- CREA app: jobs/applications, projects workspace, profile rates, storage notes.
-- Run in Supabase SQL Editor after existing profile migrations.

-- ---------------------------------------------------------------------------
-- Profile: freelancer rates (shown under Settings → Rates)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists day_rate_amount numeric;
alter table public.profiles add column if not exists half_day_rate_amount numeric;
alter table public.profiles add column if not exists rates_currency text default 'EUR';
alter table public.profiles add column if not exists rates_notes text;

comment on column public.profiles.day_rate_amount is 'Default day rate (numeric, same currency as rates_currency)';
comment on column public.profiles.half_day_rate_amount is 'Optional half-day rate';
comment on column public.profiles.rates_currency is 'ISO currency for rates';
comment on column public.profiles.rates_notes is 'Packages, buyouts, travel, etc.';

-- ---------------------------------------------------------------------------
-- Jobs: description for detail screen
-- ---------------------------------------------------------------------------
alter table public.jobs add column if not exists description text;

-- ---------------------------------------------------------------------------
-- Job applications (freelancer applies from app)
-- ---------------------------------------------------------------------------
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  freelancer_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  message text,
  created_at timestamptz not null default now(),
  unique (job_id, freelancer_id)
);

create index if not exists job_applications_job_id_idx on public.job_applications (job_id);
create index if not exists job_applications_freelancer_id_idx on public.job_applications (freelancer_id);

alter table public.job_applications enable row level security;

drop policy if exists "job_applications_select" on public.job_applications;
create policy "job_applications_select" on public.job_applications
  for select using (
    auth.uid() = freelancer_id
    or exists (
      select 1 from public.jobs j
      where j.id = job_id and j.company_id = auth.uid()
    )
  );

drop policy if exists "job_applications_insert" on public.job_applications;
create policy "job_applications_insert" on public.job_applications
  for insert with check (auth.uid() = freelancer_id);

drop policy if exists "job_applications_update_company" on public.job_applications;
create policy "job_applications_update_company" on public.job_applications
  for update using (
    exists (
      select 1 from public.jobs j
      where j.id = job_id and j.company_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Projects (workspace modal in app; full Brief AI on web)
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs (id) on delete set null,
  company_id uuid not null references public.profiles (id) on delete cascade,
  freelancer_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  status text not null default 'active',
  budget_amount numeric,
  budget_type text,
  location text,
  milestones_completed int not null default 0,
  milestones_total int not null default 0,
  brief_ai_context text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_job_id_idx on public.projects (job_id);
create unique index if not exists projects_one_per_job_idx on public.projects (job_id) where job_id is not null;
create index if not exists projects_company_id_idx on public.projects (company_id);
create index if not exists projects_freelancer_id_idx on public.projects (freelancer_id);

alter table public.projects enable row level security;

drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select using (auth.uid() = company_id or auth.uid() = freelancer_id);

drop policy if exists "projects_insert_company" on public.projects;
create policy "projects_insert_company" on public.projects
  for insert with check (auth.uid() = company_id);

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update using (auth.uid() = company_id or auth.uid() = freelancer_id);

-- ---------------------------------------------------------------------------
-- Storage: create bucket "avatars" in Dashboard → Storage (public).
-- Then run policies below (adjust if policies already exist).
-- ---------------------------------------------------------------------------
-- insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
--   on conflict (id) do nothing;

-- drop policy if exists "avatars_select_public" on storage.objects;
-- create policy "avatars_select_public" on storage.objects
--   for select using (bucket_id = 'avatars');

-- drop policy if exists "avatars_insert_own" on storage.objects;
-- create policy "avatars_insert_own" on storage.objects
--   for insert with check (
--     bucket_id = 'avatars'
--     and (storage.foldername (name))[1] = auth.uid()::text
--   );

-- drop policy if exists "avatars_update_own" on storage.objects;
-- create policy "avatars_update_own" on storage.objects
--   for update using (
--     bucket_id = 'avatars'
--     and (storage.foldername (name))[1] = auth.uid()::text
--   );

-- drop policy if exists "avatars_delete_own" on storage.objects;
-- create policy "avatars_delete_own" on storage.objects
--   for delete using (
--     bucket_id = 'avatars'
--     and (storage.foldername (name))[1] = auth.uid()::text
--   );

-- ---------------------------------------------------------------------------
-- Invoices (optional RLS — uncomment if you need app-side create / mark paid)
-- ---------------------------------------------------------------------------
-- alter table public.invoices enable row level security;
-- create policy "invoices_participants_read" on public.invoices
--   for select using (auth.uid() = company_id or auth.uid() = freelancer_id);
-- create policy "invoices_company_insert" on public.invoices
--   for insert with check (auth.uid() = company_id);
-- create policy "invoices_company_update" on public.invoices
--   for update using (auth.uid() = company_id);
