-- Guardrail: workspace-only projects must never appear in marketplace job reads.
-- Run this in Supabase SQL Editor for the crea-app project.

do $$
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'jobs'
  ) then
    return;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'is_solo_workspace'
  ) then
    return;
  end if;

  execute 'drop policy if exists "jobs_select_active_marketplace" on public.jobs';
  execute '
    create policy "jobs_select_active_marketplace" on public.jobs
      for select to authenticated
      using (
        status = ''active''
        and not coalesce(is_solo_workspace, false)
      )
  ';

  execute 'drop policy if exists "jobs_select_active_anon" on public.jobs';
  execute '
    create policy "jobs_select_active_anon" on public.jobs
      for select to anon
      using (
        status = ''active''
        and not coalesce(is_solo_workspace, false)
      )
  ';
end $$;

comment on policy "jobs_select_active_marketplace" on public.jobs is
  'Authenticated marketplace feed: only active non-workspace listings.';

comment on policy "jobs_select_active_anon" on public.jobs is
  'Anonymous marketplace feed: only active non-workspace listings.';
