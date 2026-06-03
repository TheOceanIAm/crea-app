-- Company could not remove accepted crew: delete policy only allowed member_role = 'crew',
-- but marketplace projects seed the first freelancer as 'lead' in project_members.

drop policy if exists "project_members_delete_lead" on public.project_members;
drop policy if exists "project_members_delete_company_crew" on public.project_members;

create policy "project_members_delete_company_crew"
  on public.project_members
  for delete
  to authenticated
  using (
    lower(coalesce(member_role, '')) <> 'company'
    and exists (
      select 1
      from public.projects p
      where p.id = project_id
        and (auth.uid() = p.company_id or auth.uid() = p.freelancer_id)
    )
  );

comment on policy "project_members_delete_company_crew" on public.project_members is
  'Project company or legacy lead may remove crew/lead rows (not the company member row).';

create or replace function public.sync_job_freelancer_visibility_from_applications()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.job_freelancer_visibility
    where job_id = old.job_id and freelancer_id = old.freelancer_id;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.job_id is distinct from new.job_id or old.freelancer_id is distinct from new.freelancer_id then
      delete from public.job_freelancer_visibility
      where job_id = old.job_id and freelancer_id = old.freelancer_id;
    end if;
    if new.status = 'accepted' then
      insert into public.job_freelancer_visibility (job_id, freelancer_id)
      values (new.job_id, new.freelancer_id)
      on conflict (job_id, freelancer_id) do nothing;
    elsif coalesce(old.status, '') = 'accepted' and coalesce(new.status, '') <> 'accepted' then
      delete from public.job_freelancer_visibility
      where job_id = new.job_id and freelancer_id = new.freelancer_id;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'accepted' then
      insert into public.job_freelancer_visibility (job_id, freelancer_id)
      values (new.job_id, new.freelancer_id)
      on conflict (job_id, freelancer_id) do nothing;
    end if;
    return new;
  end if;
  return null;
end;
$$;

create or replace function public.trg_project_members_clear_job_visibility_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  jid uuid;
begin
  select p.job_id into jid
  from public.projects p
  where p.id = old.project_id;

  if jid is null then
    return old;
  end if;

  if exists (
    select 1
    from public.job_applications ja
    where ja.job_id = jid
      and ja.freelancer_id = old.profile_id
      and ja.status = 'accepted'
  ) then
    return old;
  end if;

  delete from public.job_freelancer_visibility
  where job_id = jid and freelancer_id = old.profile_id;

  return old;
end;
$$;

drop trigger if exists trg_project_members_clear_job_visibility on public.project_members;
create trigger trg_project_members_clear_job_visibility
  after delete on public.project_members
  for each row
  execute function public.trg_project_members_clear_job_visibility_on_delete();
