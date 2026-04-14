-- Block non-CEO users from messaging CEO accounts (one-way: CEO → users only).
-- Requires public.conversations and public.messages with columns used below.
-- Safe to re-run: drops triggers first.

-- `conversations.id` may be uuid or text depending on schema; compare as text.
create or replace function public._conversation_includes_ceo(p_conv_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.conversations c
    join public.profiles p1 on p1.id::text = c.participant_1::text
    join public.profiles p2 on p2.id::text = c.participant_2::text
    where c.id::text = p_conv_id
      and (
        lower(trim(coalesce(p1.role::text, ''))) = 'ceo'
        or lower(trim(coalesce(p2.role::text, ''))) = 'ceo'
      )
  );
$$;

revoke all on function public._conversation_includes_ceo(text) from public;

create or replace function public._caller_profile_is_ceo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(trim(coalesce(p.role::text, ''))) = 'ceo'
  );
$$;

revoke all on function public._caller_profile_is_ceo() from public;

create or replace function public.enforce_conversation_not_with_ceo_for_nonceo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r1 text;
  r2 text;
begin
  select lower(trim(coalesce(role::text, ''))) into r1
  from public.profiles where id::text = NEW.participant_1::text;
  select lower(trim(coalesce(role::text, ''))) into r2
  from public.profiles where id::text = NEW.participant_2::text;

  if r1 = 'ceo' or r2 = 'ceo' then
    if not public._caller_profile_is_ceo() then
      raise exception 'Direct messages to this account are not available. The team may reach out to you from here.'
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$$;

create or replace function public.enforce_message_not_inbound_to_ceo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._conversation_includes_ceo(NEW.conversation_id::text) and not public._caller_profile_is_ceo() then
    raise exception 'You cannot send messages in this conversation.'
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_conversations_block_nonceo_with_ceo on public.conversations;
drop trigger if exists trg_messages_block_nonceo_to_ceo on public.messages;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'conversations'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations' and column_name = 'participant_1'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations' and column_name = 'participant_2'
  ) then
    create trigger trg_conversations_block_nonceo_with_ceo
      before insert on public.conversations
      for each row
      execute procedure public.enforce_conversation_not_with_ceo_for_nonceo();
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'messages'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'conversation_id'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'sender_id'
  ) then
    create trigger trg_messages_block_nonceo_to_ceo
      before insert on public.messages
      for each row
      execute procedure public.enforce_message_not_inbound_to_ceo();
  end if;
end;
$$;

comment on function public.enforce_conversation_not_with_ceo_for_nonceo() is 'Non-CEO cannot open a DM with a CEO participant.';
comment on function public.enforce_message_not_inbound_to_ceo() is 'Non-CEO cannot post in any conversation that includes a CEO.';
