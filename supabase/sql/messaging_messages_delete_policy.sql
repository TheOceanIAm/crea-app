-- Allow conversation participants to delete messages in their DM (1:1).
-- Safe to re-run.

drop policy if exists "messages_delete_for_participants" on public.messages;

create policy "messages_delete_for_participants"
  on public.messages
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and (c.participant_1 = auth.uid() or c.participant_2 = auth.uid())
    )
  );

comment on policy "messages_delete_for_participants" on public.messages is
  'Either participant may delete a message row in this conversation.';
