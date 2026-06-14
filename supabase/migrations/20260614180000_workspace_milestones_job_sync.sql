-- Keep in sync with crea-services/supabase/migrations/20260614180000_workspace_milestones_job_sync.sql
-- Web + app share public.milestones (job_id). Sync project overview counts from job milestones.

create or replace function public.sync_project_milestone_counts_from_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
  total int;
  done int;
begin
  if p_job_id is null then
    return;
  end if;

  select count(*)::int,
         count(*) filter (where lower(coalesce(status, '')) = 'completed')::int
    into total, done
  from public.milestones
  where job_id = p_job_id;

  for pid in
    select p.id from public.projects p where p.job_id = p_job_id
  loop
    update public.projects
    set milestones_total = total,
        milestones_completed = done
    where id = pid;
  end loop;
end;
$$;

create or replace function public.trg_sync_project_milestone_counts_from_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_project_milestone_counts_from_job(coalesce(new.job_id, old.job_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_job_milestone_counts on public.milestones;
create trigger trg_job_milestone_counts
  after insert or update or delete on public.milestones
  for each row execute function public.trg_sync_project_milestone_counts_from_job();

-- One-time: copy app-only checklist rows into the shared job milestones table.
insert into public.milestones (job_id, title, description, status, position, due_at, due_date)
select
  p.job_id,
  pm.title,
  '',
  case when pm.completed then 'completed' else 'pending' end,
  pm.sort_order,
  pm.scheduled_at,
  pm.scheduled_at
from public.project_milestones pm
inner join public.projects p on p.id = pm.project_id
where p.job_id is not null
  and not exists (
    select 1
    from public.milestones m
    where m.job_id = p.job_id
      and lower(trim(m.title)) = lower(trim(pm.title))
  );

-- Refresh overview counters for all linked projects.
do $$
declare
  jid uuid;
begin
  for jid in select distinct job_id from public.projects where job_id is not null
  loop
    perform public.sync_project_milestone_counts_from_job(jid);
  end loop;
end;
$$;

-- RLS: same workspace access model as job_messages (select/update for crew; insert/delete for company).
drop policy if exists "milestones_select_workspace" on public.milestones;
create policy "milestones_select_workspace"
  on public.milestones for select to authenticated
  using (public.crea_current_user_workspace_job_access(job_id));

drop policy if exists "milestones_insert_company" on public.milestones;
create policy "milestones_insert_company"
  on public.milestones for insert to authenticated
  with check (public.crea_rls_job_company_is_owner(job_id));

drop policy if exists "milestones_update_workspace" on public.milestones;
create policy "milestones_update_workspace"
  on public.milestones for update to authenticated
  using (public.crea_current_user_workspace_job_access(job_id))
  with check (public.crea_current_user_workspace_job_access(job_id));

drop policy if exists "milestones_delete_company" on public.milestones;
create policy "milestones_delete_company"
  on public.milestones for delete to authenticated
  using (public.crea_rls_job_company_is_owner(job_id));
