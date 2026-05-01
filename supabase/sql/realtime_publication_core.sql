-- Enable postgres_changes for messaging (live unread + banners).
-- Safe to re-run: ignores "already member of publication" (SQLSTATE 42710).
--
-- If INSERT/UPDATE events never arrive on clients, also confirm in Supabase Dashboard:
-- Database → Replication → enable for `messages`, `conversations` (must match publication).

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'messages',
    'conversations',
    'project_messages',
    'projects',
    'job_applications',
    'invoices',
    'user_alert_reads'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception
      when others then
        if sqlstate = '42710' then
          -- duplicate_object / already in publication
          null;
        else
          raise;
        end if;
    end;
  end loop;
end $$;
