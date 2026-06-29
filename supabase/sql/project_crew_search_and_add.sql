-- Project crew: search freelancers by name (for leads/clients with manage access)
-- and INVITE crew by profile id. Run in Supabase SQL Editor after
-- project_workspace_native.sql and freelancer_profiles exist.
--
-- NOTE: Adding a freelancer creates a PENDING invite in `project_crew_invites`
-- (see migration 20260629120000_project_crew_invites.sql). The freelancer must
-- accept before a `project_members` row is created and access is granted.

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

comment on function public.search_freelancers_for_project_crew(uuid, text) is
  'Name search for inviting registered freelancers to a project; caller must be company or lead.';

revoke all on function public.search_freelancers_for_project_crew(uuid, text) from public;
grant execute on function public.search_freelancers_for_project_crew(uuid, text) to authenticated;

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
