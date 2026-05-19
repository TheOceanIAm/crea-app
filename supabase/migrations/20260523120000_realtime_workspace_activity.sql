-- Realtime for workspace toasts (messages, files, milestones).
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'job_messages',
    'job_attachments',
    'project_messages',
    'project_milestones',
    'milestones'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception
      when others then
        if sqlstate = '42710' then
          null;
        else
          raise;
        end if;
    end;
  end loop;
end $$;
