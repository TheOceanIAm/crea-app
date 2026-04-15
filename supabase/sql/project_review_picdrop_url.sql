-- PicDrop review link on projects (run in Supabase SQL Editor after project_workspace_native.sql).

alter table public.projects add column if not exists picdrop_url text;

comment on column public.projects.picdrop_url is 'Optional PicDrop gallery or delivery link for reviews.';

create or replace function public.project_update_picdrop_url(p_project_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (auth.uid() = p.company_id or auth.uid() = p.freelancer_id)
  ) then
    raise exception 'forbidden';
  end if;
  update public.projects
  set picdrop_url = nullif(trim(p_url), ''),
      updated_at = now()
  where id = p_project_id;
end;
$$;

grant execute on function public.project_update_picdrop_url(uuid, text) to authenticated;
