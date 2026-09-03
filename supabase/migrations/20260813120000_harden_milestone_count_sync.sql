-- Keep in sync with crea-services/supabase/migrations/20260813120000_harden_milestone_count_sync.sql
-- Harden job→project milestone count sync so a failed projects UPDATE (e.g. RLS)
-- does not leave the milestones mutation transaction poisoned with
-- "current transaction is aborted, commands ignored until end of transaction block".

create or replace function public.sync_project_milestone_counts_from_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  total int;
  done int;
begin
  if p_job_id is null then
    return;
  end if;

  begin
    select count(*)::int,
           count(*) filter (where lower(coalesce(status, '')) = 'completed')::int
      into total, done
      from public.milestones
     where job_id = p_job_id;

    update public.projects
       set milestones_total = total,
           milestones_completed = done
     where job_id = p_job_id;
  exception
    when others then
      raise exception 'milestone count sync failed for job %: %', p_job_id, sqlerrm
        using errcode = sqlstate;
  end;
end;
$$;

create or replace function public.trg_sync_project_milestone_counts_from_job()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  jid uuid := coalesce(new.job_id, old.job_id);
begin
  begin
    perform public.sync_project_milestone_counts_from_job(jid);
  exception
    when others then
      -- Surface the root cause once; never continue after a failed statement
      -- inside the outer PostgREST transaction (avoids secondary "aborted" errors).
      raise exception 'milestone count sync trigger failed (job %): %', jid, sqlerrm
        using errcode = sqlstate;
  end;
  return coalesce(new, old);
end;
$$;

comment on function public.sync_project_milestone_counts_from_job(uuid) is
  'Updates projects.milestones_total/completed for all projects linked to a job. SECURITY DEFINER + row_security=off so crew milestone updates are not blocked by projects RLS.';

comment on function public.trg_sync_project_milestone_counts_from_job() is
  'AFTER insert/update/delete on milestones: sync project overview counts; raises clear root error (no poisoned follow-up).';
