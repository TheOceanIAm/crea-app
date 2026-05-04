-- Project crew: search freelancers by name (for leads/clients with manage access)
-- and add crew by profile id. Run in Supabase SQL Editor after project_workspace_native.sql
-- and freelancer_profiles exist.

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
    and position(q in lower(coalesce(pr.name, ''))) > 0
  order by pr.name asc nulls last
  limit 15;
end;
$$;

comment on function public.search_freelancers_for_project_crew(uuid, text) is
  'Name search for adding registered freelancers to project_members; caller must be company or lead.';

revoke all on function public.search_freelancers_for_project_crew(uuid, text) from public;
grant execute on function public.search_freelancers_for_project_crew(uuid, text) to authenticated;

create or replace function public.add_project_crew_by_profile_id(p_project_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target uuid := p_profile_id;
begin
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (auth.uid() = p.company_id or auth.uid() = p.freelancer_id)
  ) then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from public.profiles pr
    where pr.id = target and coalesce(pr.role, '') = 'freelancer'
  ) then
    raise exception 'Only freelancers with a Crea profile can be added this way';
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

comment on function public.add_project_crew_by_profile_id(uuid, uuid) is
  'Adds a freelancer to project_members as crew; same access rule as add_project_crew_by_email.';

revoke all on function public.add_project_crew_by_profile_id(uuid, uuid) from public;
grant execute on function public.add_project_crew_by_profile_id(uuid, uuid) to authenticated;
