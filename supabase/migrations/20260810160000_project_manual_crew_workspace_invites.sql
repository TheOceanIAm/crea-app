-- External (manual) crew → email invite → free profile + project_members claim.

alter table public.project_manual_crew
  add column if not exists claimed_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists claimed_at timestamptz;

create index if not exists project_manual_crew_claimed_profile_idx
  on public.project_manual_crew (claimed_profile_id)
  where claimed_profile_id is not null;

comment on column public.project_manual_crew.claimed_profile_id is
  'Set when the external contact accepts a workspace invite and becomes a project_members crew row.';

create table if not exists public.project_manual_crew_invites (
  id uuid primary key default gen_random_uuid(),
  manual_crew_id uuid not null references public.project_manual_crew (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  email text not null,
  token text not null unique,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists project_manual_crew_invites_pending_manual_uidx
  on public.project_manual_crew_invites (manual_crew_id)
  where status = 'pending';

create index if not exists project_manual_crew_invites_project_pending_idx
  on public.project_manual_crew_invites (project_id, status);

create index if not exists project_manual_crew_invites_token_pending_idx
  on public.project_manual_crew_invites (token)
  where status = 'pending';

alter table public.project_manual_crew_invites enable row level security;

-- Hosts can read invites for their projects (writes go through service role APIs).
drop policy if exists project_manual_crew_invites_select_host on public.project_manual_crew_invites;
create policy project_manual_crew_invites_select_host
  on public.project_manual_crew_invites
  for select to authenticated
  using (public.crea_user_is_project_host(project_id));

revoke all on table public.project_manual_crew_invites from anon;
grant select on table public.project_manual_crew_invites to authenticated;

-- Refresh readable view: expose claim fields; keep rate masking.
create or replace view public.project_manual_crew_readable
with (security_invoker = false)
as
select
  m.id,
  m.project_id,
  m.name,
  m.member_role,
  m.email,
  m.phone,
  m.created_by,
  m.created_at,
  m.updated_at,
  m.works_as,
  m.booked_dates,
  m.scheduling_start_date,
  m.scheduling_end_date,
  case
    when public.crea_user_is_project_host(m.project_id) then m.day_rate_amount
    else null
  end as day_rate_amount,
  case
    when public.crea_user_is_project_host(m.project_id) then m.half_day_rate_amount
    else null
  end as half_day_rate_amount,
  -- Appended after rates: CREATE OR REPLACE VIEW cannot rename/reorder existing columns.
  m.claimed_profile_id,
  m.claimed_at
from public.project_manual_crew m
where public.user_in_project(m.project_id, auth.uid());

comment on view public.project_manual_crew_readable is
  'project_manual_crew for clients; day_rate_* null unless viewer is project host; includes claim fields.';

grant select on public.project_manual_crew_readable to authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.project_manual_crew_readable from authenticated;

-- Cancel pending invites when the contact row is deleted (FK cascade already removes rows).
-- Accept conversion is performed in the app API with the service role (membership + claim).
