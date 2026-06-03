-- Native project workspace: crew (project_members), milestones, messages, files bucket, brief outputs.
-- Run in Supabase SQL Editor after crea_app_features.sql (projects table exists).
--
-- 1) Dashboard → Storage: create bucket "project-files" (private, not public).
-- 2) Run this script.
-- 3) Deploy edge function `brief-ai` and set ANTHROPIC_API_KEY secret.
-- 4) Optional live chat: enable replication for project_messages, e.g.
--    alter publication supabase_realtime add table public.project_messages;

-- ---------------------------------------------------------------------------
-- Columns on projects
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists frame_io_url text;
alter table public.projects add column if not exists brief_ai_outputs jsonb default '{}'::jsonb;

comment on column public.projects.frame_io_url is 'Optional Frame.io or review link for the project workspace.';
comment on column public.projects.brief_ai_outputs is 'Per-tool generated brief text: { shotlist, tasks, callsheet, gear }.';

-- ---------------------------------------------------------------------------
-- Membership (company + lead freelancer + optional crew)
-- ---------------------------------------------------------------------------
create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null default 'crew',
  created_at timestamptz not null default now(),
  unique (project_id, profile_id)
);

create index if not exists project_members_project_id_idx on public.project_members (project_id);
create index if not exists project_members_profile_id_idx on public.project_members (profile_id);

alter table public.project_members enable row level security;

-- True if user is in project_members OR legacy company/freelancer on projects row (pre-backfill safety).
create or replace function public.user_in_project(p_project_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.profile_id = p_user
  )
  or exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (p.company_id = p_user or p.freelancer_id = p_user)
  )
  or exists (
    select 1
    from public.projects p
    inner join public.jobs j on j.id = coalesce(p.job_id, p.id)
    where p.id = p_project_id
      and j.company_id = p_user
  )
  or exists (
    select 1
    from public.projects p
    inner join public.job_applications ja on ja.job_id = coalesce(p.job_id, p.id)
    where p.id = p_project_id
      and ja.freelancer_id = p_user
      and ja.status = 'accepted'
  );
$$;

grant execute on function public.user_in_project(uuid, uuid) to authenticated;

drop policy if exists "project_members_select" on public.project_members;
create policy "project_members_select" on public.project_members
  for select using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "project_members_insert_lead" on public.project_members;
create policy "project_members_insert_lead" on public.project_members
  for insert with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id
        and (auth.uid() = p.company_id or auth.uid() = p.freelancer_id)
    )
    and profile_id <> auth.uid()
  );

drop policy if exists "project_members_delete_lead" on public.project_members;
create policy "project_members_delete_company_crew" on public.project_members
  for delete using (
    lower(coalesce(member_role, '')) <> 'company'
    and exists (
      select 1 from public.projects p
      where p.id = project_id
        and (auth.uid() = p.company_id or auth.uid() = p.freelancer_id)
    )
  );

-- Seed company + lead rows when a project is created
create or replace function public.trg_projects_seed_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, profile_id, member_role)
  values (new.id, new.company_id, 'company')
  on conflict (project_id, profile_id) do nothing;
  insert into public.project_members (project_id, profile_id, member_role)
  values (new.id, new.freelancer_id, 'lead')
  on conflict (project_id, profile_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_projects_seed_members on public.projects;
create trigger trg_projects_seed_members
  after insert on public.projects
  for each row execute function public.trg_projects_seed_members();

-- Backfill existing projects
insert into public.project_members (project_id, profile_id, member_role)
select id, company_id, 'company' from public.projects
on conflict (project_id, profile_id) do nothing;
insert into public.project_members (project_id, profile_id, member_role)
select id, freelancer_id, 'lead' from public.projects
on conflict (project_id, profile_id) do nothing;

-- ---------------------------------------------------------------------------
-- Projects RLS: any member can read; only company/lead update row
-- ---------------------------------------------------------------------------
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select using (public.user_in_project(id, auth.uid()));

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update using (auth.uid() = company_id or auth.uid() = freelancer_id);

-- Solo/workspace: app inserts with company_id = auth.uid() (same user as freelancer_id).
-- Must exist whenever this file is applied; crea_app_features.sql alone may not have been run on this DB.
drop policy if exists "projects_insert_company" on public.projects;
create policy "projects_insert_company" on public.projects
  for insert to authenticated
  with check (auth.uid() = company_id);

-- ---------------------------------------------------------------------------
-- RPCs: brief + frame URL for all project members (crew can contribute brief context)
-- ---------------------------------------------------------------------------
create or replace function public.project_update_brief(p_project_id uuid, p_context text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_in_project(p_project_id, auth.uid()) then
    raise exception 'forbidden';
  end if;
  update public.projects
  set brief_ai_context = nullif(trim(p_context), ''),
      updated_at = now()
  where id = p_project_id;
end;
$$;

create or replace function public.project_merge_brief_output(p_project_id uuid, p_tool text, p_content text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_in_project(p_project_id, auth.uid()) then
    raise exception 'forbidden';
  end if;
  update public.projects
  set brief_ai_outputs = coalesce(brief_ai_outputs, '{}'::jsonb)
      || jsonb_build_object(p_tool, p_content),
      updated_at = now()
  where id = p_project_id;
end;
$$;

create or replace function public.project_update_frame_io_url(p_project_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (auth.uid() = p.company_id or auth.uid() = p.freelancer_id)
  ) then
    raise exception 'forbidden';
  end if;
  update public.projects
  set frame_io_url = nullif(trim(p_url), ''),
      updated_at = now()
  where id = p_project_id;
end;
$$;

create or replace function public.add_project_crew_by_email(p_project_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target uuid;
begin
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (auth.uid() = p.company_id or auth.uid() = p.freelancer_id)
  ) then
    raise exception 'forbidden';
  end if;

  select id into target
  from auth.users
  where lower(email) = lower(trim(p_email));

  if target is null then
    raise exception 'No user with this email';
  end if;

  if target = (select company_id from public.projects where id = p_project_id)
     or target = (select freelancer_id from public.projects where id = p_project_id) then
    raise exception 'Already a lead on this project';
  end if;

  insert into public.project_members (project_id, profile_id, member_role)
  values (p_project_id, target, 'crew')
  on conflict (project_id, profile_id) do update set member_role = excluded.member_role;
end;
$$;

grant execute on function public.project_update_brief(uuid, text) to authenticated;
grant execute on function public.project_merge_brief_output(uuid, text, text) to authenticated;
grant execute on function public.project_update_frame_io_url(uuid, text) to authenticated;
grant execute on function public.add_project_crew_by_email(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Milestones
-- ---------------------------------------------------------------------------
create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  sort_order int not null default 0,
  completed boolean not null default false,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists project_milestones_project_id_idx on public.project_milestones (project_id);

alter table public.project_milestones enable row level security;

drop policy if exists "project_milestones_all" on public.project_milestones;
drop policy if exists "project_milestones_select" on public.project_milestones;
drop policy if exists "project_milestones_insert" on public.project_milestones;
drop policy if exists "project_milestones_update" on public.project_milestones;
drop policy if exists "project_milestones_delete" on public.project_milestones;
create policy "project_milestones_select" on public.project_milestones
  for select using (public.user_in_project(project_id, auth.uid()));
create policy "project_milestones_insert" on public.project_milestones
  for insert with check (public.user_in_project(project_id, auth.uid()));
create policy "project_milestones_update" on public.project_milestones
  for update using (public.user_in_project(project_id, auth.uid()));
create policy "project_milestones_delete" on public.project_milestones
  for delete using (public.user_in_project(project_id, auth.uid()));

create or replace function public.sync_project_milestone_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  pid := coalesce(new.project_id, old.project_id);
  update public.projects
  set
    milestones_total = (select count(*)::int from public.project_milestones where project_id = pid),
    milestones_completed = (
      select count(*)::int from public.project_milestones where project_id = pid and completed
    ),
    updated_at = now()
  where id = pid;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_milestone_counts on public.project_milestones;
create trigger trg_milestone_counts
  after insert or update or delete on public.project_milestones
  for each row execute function public.sync_project_milestone_counts();

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table if not exists public.project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists project_messages_project_id_idx on public.project_messages (project_id);
create index if not exists project_messages_created_idx on public.project_messages (project_id, created_at desc);

alter table public.project_messages enable row level security;

drop policy if exists "project_messages_select" on public.project_messages;
create policy "project_messages_select" on public.project_messages
  for select using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "project_messages_insert" on public.project_messages;
create policy "project_messages_insert" on public.project_messages
  for insert with check (
    sender_id = auth.uid()
    and public.user_in_project(project_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Storage: project-files bucket (private). First folder segment = project UUID.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

drop policy if exists "project_files_select" on storage.objects;
create policy "project_files_select" on storage.objects
  for select using (
    bucket_id = 'project-files'
    and public.user_in_project((storage.foldername(name))[1]::uuid, auth.uid())
  );

drop policy if exists "project_files_insert" on storage.objects;
create policy "project_files_insert" on storage.objects
  for insert with check (
    bucket_id = 'project-files'
    and public.user_in_project((storage.foldername(name))[1]::uuid, auth.uid())
  );

drop policy if exists "project_files_update" on storage.objects;
create policy "project_files_update" on storage.objects
  for update using (
    bucket_id = 'project-files'
    and public.user_in_project((storage.foldername(name))[1]::uuid, auth.uid())
  );

drop policy if exists "project_files_delete" on storage.objects;
create policy "project_files_delete" on storage.objects
  for delete using (
    bucket_id = 'project-files'
    and public.user_in_project((storage.foldername(name))[1]::uuid, auth.uid())
  );
