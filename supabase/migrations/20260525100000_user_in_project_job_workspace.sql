-- Keep in sync with crea-services/supabase/migrations/20260525100000_user_in_project_job_workspace.sql

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
