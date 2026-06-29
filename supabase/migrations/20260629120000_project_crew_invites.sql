-- Crew invite -> accept flow.
--
-- Previously `add_project_crew_by_profile_id` inserted a `project_members` row
-- immediately, which grants full workspace access via `user_in_project`. Now the
-- company/lead creates a PENDING invite instead; the freelancer accepts or
-- declines, and ONLY on accept do we insert the `project_members` row.
--
-- This deliberately leaves `user_in_project` and every existing access check
-- untouched: a `project_members` row still means "active member with access".
-- The invite lives in its own table, so a pending invite grants NO access.

create table if not exists public.project_crew_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  member_role text not null default 'crew',
  works_as text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (project_id, profile_id)
);

create index if not exists project_crew_invites_profile_pending_idx
  on public.project_crew_invites (profile_id, status);
create index if not exists project_crew_invites_project_idx
  on public.project_crew_invites (project_id, status);

alter table public.project_crew_invites enable row level security;

-- Invitee can read their own invites; the project's company/lead can read invites
-- they manage. All writes go through the SECURITY DEFINER RPCs below.
drop policy if exists project_crew_invites_select on public.project_crew_invites;
create policy project_crew_invites_select on public.project_crew_invites
  for select using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.id = project_id and (p.company_id = auth.uid() or p.freelancer_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Search: also exclude freelancers who already have a pending invite.
-- ---------------------------------------------------------------------------
create or replace function public.search_freelancers_for_project_crew(
  p_project_id uuid,
  p_query text
)
returns table (id uuid, name text, avatar_url text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := lower(trim(p_query));
begin
  if length(q) < 2 then
    return;
  end if;

  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (auth.uid() = p.company_id or auth.uid() = p.freelancer_id)
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select pr.id, pr.name, pr.avatar_url
  from public.profiles pr
  left join public.freelancer_profiles fp on fp.id = pr.id
  where coalesce(pr.role, '') = 'freelancer'
    and (fp.id is null or coalesce(fp.plan_tier, '') is distinct from 'workspace')
    and pr.id <> (select p2.company_id from public.projects p2 where p2.id = p_project_id)
    and pr.id <> (select p2.freelancer_id from public.projects p2 where p2.id = p_project_id)
    and not exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id and pm.profile_id = pr.id
    )
    and not exists (
      select 1 from public.project_crew_invites ci
      where ci.project_id = p_project_id and ci.profile_id = pr.id and ci.status = 'pending'
    )
    and position(q in lower(coalesce(pr.name, ''))) > 0
  order by pr.name asc nulls last
  limit 15;
end;
$$;

revoke all on function public.search_freelancers_for_project_crew(uuid, text) from public;
grant execute on function public.search_freelancers_for_project_crew(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- add_project_crew_by_profile_id now creates a PENDING invite (return uuid).
-- Return type changes from void -> uuid, so drop the old signature first.
-- ---------------------------------------------------------------------------
drop function if exists public.add_project_crew_by_profile_id(uuid, uuid);

create or replace function public.add_project_crew_by_profile_id(p_project_id uuid, p_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target uuid := p_profile_id;
  inviter uuid := auth.uid();
  invite_id uuid;
begin
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (inviter = p.company_id or inviter = p.freelancer_id)
  ) then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from public.profiles pr
    where pr.id = target and coalesce(pr.role, '') = 'freelancer'
  ) then
    raise exception 'Only freelancers with a Crea profile can be invited this way';
  end if;

  if target = (select company_id from public.projects where id = p_project_id)
     or target = (select freelancer_id from public.projects where id = p_project_id) then
    raise exception 'Already a lead on this project';
  end if;

  if exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id and pm.profile_id = target
  ) then
    raise exception 'Already on this project';
  end if;

  insert into public.project_crew_invites (project_id, profile_id, invited_by, member_role, status)
  values (p_project_id, target, inviter, 'crew', 'pending')
  on conflict (project_id, profile_id) do update
    set status = 'pending',
        invited_by = excluded.invited_by,
        member_role = 'crew',
        created_at = now(),
        responded_at = null
  returning id into invite_id;

  return invite_id;
end;
$$;

comment on function public.add_project_crew_by_profile_id(uuid, uuid) is
  'Creates a PENDING project_crew_invites row for a freelancer; access is only granted after they accept.';

revoke all on function public.add_project_crew_by_profile_id(uuid, uuid) from public;
grant execute on function public.add_project_crew_by_profile_id(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Freelancer responds to an invite. On accept -> insert project_members.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_project_crew_invite(p_invite_id uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  inv public.project_crew_invites;
  act text := lower(trim(coalesce(p_action, '')));
begin
  select * into inv from public.project_crew_invites where id = p_invite_id;
  if not found then
    raise exception 'invite_not_found';
  end if;
  if inv.profile_id <> auth.uid() then
    raise exception 'forbidden';
  end if;
  if inv.status <> 'pending' then
    return inv.status;
  end if;

  if act = 'accept' then
    insert into public.project_members (project_id, profile_id, member_role, works_as)
    values (inv.project_id, inv.profile_id, coalesce(nullif(inv.member_role, ''), 'crew'), inv.works_as)
    on conflict (project_id, profile_id) do update set member_role = excluded.member_role;
    update public.project_crew_invites set status = 'accepted', responded_at = now() where id = inv.id;
    return 'accepted';
  elsif act = 'decline' then
    update public.project_crew_invites set status = 'declined', responded_at = now() where id = inv.id;
    return 'declined';
  else
    raise exception 'invalid_action';
  end if;
end;
$$;

revoke all on function public.respond_to_project_crew_invite(uuid, text) from public;
grant execute on function public.respond_to_project_crew_invite(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Company/lead cancels a pending invite.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_project_crew_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  inv public.project_crew_invites;
begin
  select * into inv from public.project_crew_invites where id = p_invite_id;
  if not found then
    return;
  end if;
  if not exists (
    select 1 from public.projects p
    where p.id = inv.project_id and (auth.uid() = p.company_id or auth.uid() = p.freelancer_id)
  ) then
    raise exception 'forbidden';
  end if;
  update public.project_crew_invites set status = 'cancelled', responded_at = now()
  where id = inv.id and status = 'pending';
end;
$$;

revoke all on function public.cancel_project_crew_invite(uuid) from public;
grant execute on function public.cancel_project_crew_invite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- List the signed-in freelancer's pending invites (SECURITY DEFINER so the
-- invitee can read the project title/company name without workspace access).
-- ---------------------------------------------------------------------------
create or replace function public.list_my_crew_invites()
returns table (id uuid, project_id uuid, project_title text, company_name text, invited_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    ci.id,
    ci.project_id,
    coalesce(nullif(p.title, ''), 'Project') as project_title,
    coalesce(nullif(cpr.name, ''), 'A company') as company_name,
    ci.created_at as invited_at
  from public.project_crew_invites ci
  join public.projects p on p.id = ci.project_id
  left join public.profiles cpr on cpr.id = p.company_id
  where ci.profile_id = auth.uid() and ci.status = 'pending'
  order by ci.created_at desc
  limit 50;
$$;

revoke all on function public.list_my_crew_invites() from public;
grant execute on function public.list_my_crew_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- List pending invites for a project (company/lead only), with invitee details.
-- ---------------------------------------------------------------------------
create or replace function public.list_project_crew_invites(p_project_id uuid)
returns table (id uuid, profile_id uuid, name text, avatar_url text, status text, invited_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and (auth.uid() = p.company_id or auth.uid() = p.freelancer_id)
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select ci.id, ci.profile_id, pr.name, pr.avatar_url, ci.status, ci.created_at
  from public.project_crew_invites ci
  join public.profiles pr on pr.id = ci.profile_id
  where ci.project_id = p_project_id and ci.status = 'pending'
  order by ci.created_at desc;
end;
$$;

revoke all on function public.list_project_crew_invites(uuid) from public;
grant execute on function public.list_project_crew_invites(uuid) to authenticated;

-- Realtime (best-effort; ignore if already in the publication).
do $$
begin
  begin
    alter publication supabase_realtime add table public.project_crew_invites;
  exception when duplicate_object then null;
  when others then null;
  end;
end $$;
