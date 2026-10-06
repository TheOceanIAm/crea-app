-- Keep in sync with crea-services/supabase/migrations/20261006193000_production_shot_sheets.sql
-- One custom shot list per project and shoot day.
-- Uploading on the website or in the app writes this row, so both show the same list.
-- "Standard list" deletes the row and the fixed CREA cards show again.

create table if not exists public.production_shot_sheets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  shoot_date date not null,
  columns jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  source_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, shoot_date),
  constraint production_shot_sheets_columns_array check (jsonb_typeof(columns) = 'array'),
  constraint production_shot_sheets_rows_array check (jsonb_typeof(rows) = 'array')
);

comment on table public.production_shot_sheets is
  'Custom shot list for one shoot day. Columns and rows come from an uploaded Excel file or PDF.';

create index if not exists production_shot_sheets_project_idx
  on public.production_shot_sheets (project_id, shoot_date);

alter table public.production_shot_sheets enable row level security;

drop policy if exists "production_shot_sheets_select" on public.production_shot_sheets;
create policy "production_shot_sheets_select" on public.production_shot_sheets
  for select using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_shot_sheets_insert" on public.production_shot_sheets;
create policy "production_shot_sheets_insert" on public.production_shot_sheets
  for insert with check (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_shot_sheets_update" on public.production_shot_sheets;
create policy "production_shot_sheets_update" on public.production_shot_sheets
  for update using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_shot_sheets_delete" on public.production_shot_sheets;
create policy "production_shot_sheets_delete" on public.production_shot_sheets
  for delete using (public.user_in_project(project_id, auth.uid()));

drop trigger if exists trg_production_shot_sheets_updated on public.production_shot_sheets;
create trigger trg_production_shot_sheets_updated
  before update on public.production_shot_sheets
  for each row execute function public.production_set_updated_at();

alter table public.production_shot_sheets replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.production_shot_sheets;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

grant select, insert, update, delete on public.production_shot_sheets to authenticated;

notify pgrst, 'reload schema';
