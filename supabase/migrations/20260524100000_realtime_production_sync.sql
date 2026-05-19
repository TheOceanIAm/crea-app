-- Realtime for shotlist / call sheet sync between web workspace and mobile app.
do $$
declare
  tbl text;
begin
  foreach tbl in array array['production_days', 'production_shots']
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
