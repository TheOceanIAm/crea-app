-- Allow users to reply in conversations that include a CEO.
-- This disables the former one-way CEO DM trigger restrictions.

drop trigger if exists trg_conversations_block_nonceo_with_ceo on public.conversations;
drop trigger if exists trg_messages_block_nonceo_to_ceo on public.messages;

-- Keep helper functions callable but make them permissive/no-op.
create or replace function public.enforce_conversation_not_with_ceo_for_nonceo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;

create or replace function public.enforce_message_not_inbound_to_ceo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;

comment on function public.enforce_conversation_not_with_ceo_for_nonceo() is
  'No-op: direct conversations with CEO accounts are allowed.';
comment on function public.enforce_message_not_inbound_to_ceo() is
  'No-op: replying to CEO conversations is allowed.';

