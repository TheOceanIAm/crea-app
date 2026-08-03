-- Keep in sync with crea-services/supabase/migrations/20260803130000_dm_unread_counts_rpc.sql
-- Aggregate unread DM counts per conversation (avoids pulling every unread row to the client).
-- Note: messages.conversation_id is text in this schema.

create or replace function public.crea_dm_unread_counts(p_ids text[])
returns table (conversation_id text, unread_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.conversation_id::text, count(*)::bigint as unread_count
  from public.messages m
  where m.conversation_id = any(p_ids)
    and m.read = false
    and m.sender_id is distinct from auth.uid()
  group by m.conversation_id;
$$;

revoke all on function public.crea_dm_unread_counts(text[]) from public;
grant execute on function public.crea_dm_unread_counts(text[]) to authenticated;

comment on function public.crea_dm_unread_counts(text[]) is
  'Unread message counts per conversation for the calling user (excludes own sends).';
