-- Allow users to delete their own workspace chat messages (job + project threads).

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_messages' and policyname = 'job_messages_delete_own'
  ) then
    create policy "job_messages_delete_own"
      on public.job_messages for delete
      to authenticated
      using (
        sender_id = auth.uid()
        and public.crea_current_user_workspace_job_access(job_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'project_messages' and policyname = 'project_messages_delete_own'
  ) then
    create policy "project_messages_delete_own"
      on public.project_messages for delete
      to authenticated
      using (
        sender_id = auth.uid()
        and public.user_in_project(project_id, auth.uid())
      );
  end if;
end;
$policy$;
