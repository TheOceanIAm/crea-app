-- Allow conversation participants to mark messages as read (recipient updates incoming).
-- Fixes red-dot / unread count when opening a thread.

drop policy if exists "messages_update_participant" on public.messages;
create policy "messages_update_participant"
  on public.messages
  for update
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
    )
  );

comment on policy "messages_update_participant" on public.messages is
  'Participants can update message rows in their 1:1 conversation (e.g. read receipts).';
