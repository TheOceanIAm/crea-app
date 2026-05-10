-- Authoritative “last activity” for DM inbox: max(messages.created_at) per conversation.
-- conversations.last_message_at is updated from clients and can drift from actual message times.

create or replace function public.crea_dm_conversation_activity(p_ids uuid[])
returns table (conversation_id uuid, last_msg_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select m.conversation_id, max(m.created_at) as last_msg_at
  from public.messages m
  where m.conversation_id = any(p_ids)
  group by m.conversation_id;
$$;

revoke all on function public.crea_dm_conversation_activity(uuid[]) from public;
grant execute on function public.crea_dm_conversation_activity(uuid[]) to authenticated;

comment on function public.crea_dm_conversation_activity(uuid[]) is
  'Returns latest message created_at per conversation for inbox sorting/time labels.';
