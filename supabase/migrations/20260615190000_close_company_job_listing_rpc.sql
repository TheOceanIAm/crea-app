-- Keep in sync with crea-services/supabase/migrations/20260615190000_close_company_job_listing_rpc.sql
-- Reliable close for marketplace listings (bypasses flaky client-side RLS updates).

create or replace function public.close_company_job_listing(p_job_id uuid)
returns table (
  id uuid,
  status text,
  project_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs%ROWTYPE;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into j
  from public.jobs
  where jobs.id = p_job_id
  for update;

  if not found then
    raise exception 'job not found';
  end if;

  if coalesce(j.is_solo_workspace, false) then
    raise exception 'use workspace archive for solo projects';
  end if;

  if j.company_id is distinct from auth.uid()
     and not public.auth_user_can_write_company(j.company_id) then
    raise exception 'forbidden';
  end if;

  update public.jobs
  set status = 'closed'
  where jobs.id = p_job_id
  returning * into j;

  return query
  select j.id, j.status::text, j.project_status::text;
end;
$$;

revoke all on function public.close_company_job_listing(uuid) from public;
grant execute on function public.close_company_job_listing(uuid) to authenticated;

comment on function public.close_company_job_listing(uuid) is
  'Company closes a public marketplace job listing (jobs.status → closed).';
