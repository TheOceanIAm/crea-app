-- Ensure workspace projects can be archived via status='archived'.
-- Some older environments may have a restrictive status check.

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.projects'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.projects drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.projects
add constraint projects_status_check
check (status in ('active', 'in_progress', 'completed', 'archived'));
