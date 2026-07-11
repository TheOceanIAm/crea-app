-- Track when Frame.io / PicDrop links change so Alerts can show specific copy (app + web).

alter table public.projects
  add column if not exists frame_io_url_updated_at timestamptz,
  add column if not exists frame_io_url_updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists picdrop_url_updated_at timestamptz,
  add column if not exists picdrop_url_updated_by uuid references public.profiles (id) on delete set null;

alter table public.jobs
  add column if not exists frameio_url_updated_at timestamptz,
  add column if not exists frameio_url_updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists picdrop_url_updated_at timestamptz,
  add column if not exists picdrop_url_updated_by uuid references public.profiles (id) on delete set null;

create or replace function public.project_update_frame_io_url(p_project_id uuid, p_url text)
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
  set frame_io_url = nullif(trim(p_url), ''),
      frame_io_url_updated_at = now(),
      frame_io_url_updated_by = auth.uid(),
      updated_at = now()
  where id = p_project_id;
end;
$$;

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
      picdrop_url_updated_at = now(),
      picdrop_url_updated_by = auth.uid(),
      updated_at = now()
  where id = p_project_id;
end;
$$;

create or replace function public.crea_job_set_frameio_project_url(p_job_id uuid, p_url text)
returns public.jobs
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  j public.jobs%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  if not (
    exists (select 1 from public.jobs x where x.id = p_job_id and x.company_id = (select auth.uid()))
    or public.crea_current_user_accepted_on_job(p_job_id)
  ) then
    raise exception 'not allowed';
  end if;

  update public.jobs
  set frameio_project_url = nullif(trim(coalesce(p_url, '')), ''),
      frameio_url_updated_at = now(),
      frameio_url_updated_by = auth.uid()
  where id = p_job_id
  returning * into j;

  if not found then
    raise exception 'job not found';
  end if;

  return j;
end;
$$;

create or replace function public.crea_job_set_picdrop_project_url(p_job_id uuid, p_url text)
returns public.jobs
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  j public.jobs%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;

  if not (
    exists (select 1 from public.jobs x where x.id = p_job_id and x.company_id = (select auth.uid()))
    or public.crea_current_user_accepted_on_job(p_job_id)
  ) then
    raise exception 'not allowed';
  end if;

  update public.jobs
  set picdrop_project_url = nullif(trim(coalesce(p_url, '')), ''),
      picdrop_url_updated_at = now(),
      picdrop_url_updated_by = auth.uid()
  where id = p_job_id
  returning * into j;

  if not found then
    raise exception 'job not found';
  end if;

  return j;
end;
$$;

grant execute on function public.project_update_frame_io_url(uuid, text) to authenticated;
grant execute on function public.project_update_picdrop_url(uuid, text) to authenticated;
grant execute on function public.crea_job_set_frameio_project_url(uuid, text) to authenticated;
grant execute on function public.crea_job_set_picdrop_project_url(uuid, text) to authenticated;
