-- Optional: clearer postgres_changes UPDATE payloads for `public.messages` (e.g. read receipts).
-- Not required for row counts; apply if Realtime still misses message updates in your project.

alter table public.messages replica identity full;

comment on table public.messages is
  'REPLICA IDENTITY FULL helps clients receive full old/new rows on Realtime UPDATE (e.g. read flag).';
