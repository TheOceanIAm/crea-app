-- Crew @mentions in project workspace chat.
-- Keep in sync with crea-services/supabase/migrations/20261001143000_workspace_message_mentions.sql

create table if not exists public.workspace_message_mentions (
  id uuid primary key default gen_random_uuid(),
  project_message_id uuid references public.project_messages (id) on delete cascade,
  job_message_id uuid references public.job_messages (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  constraint workspace_message_mentions_one_parent check (
    num_nonnulls(project_message_id, job_message_id) = 1
  ),
  constraint workspace_message_mentions_label_len check (
    char_length(btrim(label)) between 1 and 120
  )
);

create unique index if not exists workspace_message_mentions_project_profile_uidx
  on public.workspace_message_mentions (project_message_id, profile_id)
  where project_message_id is not null;

create unique index if not exists workspace_message_mentions_job_profile_uidx
  on public.workspace_message_mentions (job_message_id, profile_id)
  where job_message_id is not null;

create index if not exists workspace_message_mentions_profile_idx
  on public.workspace_message_mentions (profile_id);

comment on table public.workspace_message_mentions is
  'People tagged in a workspace chat message. One row per parent message (project_messages or its job_messages mirror).';

-- Mentioned profile must already have workspace access on that job.
create or replace function public.profile_in_job_workspace(p_job_id uuid, p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_job_id is not null
    and p_profile is not null
    and (
      exists (
        select 1 from public.jobs j
        where j.id = p_job_id and j.company_id = p_profile
      )
      or exists (
        select 1 from public.job_applications ja
        where ja.job_id = p_job_id
          and ja.freelancer_id = p_profile
          and ja.status = 'accepted'
      )
      or exists (
        select 1 from public.projects p
        where p.job_id = p_job_id
          and public.user_in_project(p.id, p_profile)
      )
    );
$$;

revoke all on function public.profile_in_job_workspace(uuid, uuid) from public;
grant execute on function public.profile_in_job_workspace(uuid, uuid) to authenticated;

alter table public.workspace_message_mentions enable row level security;

drop policy if exists "workspace_message_mentions_select" on public.workspace_message_mentions;
create policy "workspace_message_mentions_select"
  on public.workspace_message_mentions
  for select
  to authenticated
  using (
    (
      project_message_id is not null
      and exists (
        select 1
        from public.project_messages pm
        where pm.id = project_message_id
          and public.user_in_project(pm.project_id, auth.uid())
      )
    )
    or (
      job_message_id is not null
      and exists (
        select 1
        from public.job_messages jm
        where jm.id = job_message_id
          and public.crea_current_user_workspace_job_access(jm.job_id)
      )
    )
  );

drop policy if exists "workspace_message_mentions_insert" on public.workspace_message_mentions;
create policy "workspace_message_mentions_insert"
  on public.workspace_message_mentions
  for insert
  to authenticated
  with check (
    (
      project_message_id is not null
      and job_message_id is null
      and exists (
        select 1
        from public.project_messages pm
        where pm.id = project_message_id
          and pm.sender_id = auth.uid()
          and public.user_in_project(pm.project_id, auth.uid())
          and public.user_in_project(pm.project_id, profile_id)
      )
    )
    or (
      job_message_id is not null
      and project_message_id is null
      and exists (
        select 1
        from public.job_messages jm
        where jm.id = job_message_id
          and jm.sender_id = auth.uid()
          and public.crea_current_user_workspace_job_access(jm.job_id)
          and public.profile_in_job_workspace(jm.job_id, profile_id)
      )
    )
  );

revoke all on table public.workspace_message_mentions from public, anon;
grant select, insert on table public.workspace_message_mentions to authenticated;
