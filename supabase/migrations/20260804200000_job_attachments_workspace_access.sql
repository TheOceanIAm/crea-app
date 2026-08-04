-- Align job_attachments (+ storage) with job_messages workspace access:
-- company, accepted applicant, project lead, or project_members on the linked project.

drop policy if exists "job_attachments_select_workspace" on public.job_attachments;
create policy "job_attachments_select_workspace"
  on public.job_attachments for select to authenticated
  using (public.crea_current_user_workspace_job_access(job_id));

drop policy if exists "job_attachments_insert_workspace" on public.job_attachments;
create policy "job_attachments_insert_workspace"
  on public.job_attachments for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.crea_current_user_workspace_job_access(job_id)
  );

drop policy if exists "job_attachments_storage_select" on storage.objects;
create policy "job_attachments_storage_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'job-attachments'
    and public.crea_current_user_workspace_job_access(
      nullif(split_part(name, '/', 1), '')::uuid
    )
  );

drop policy if exists "job_attachments_storage_insert" on storage.objects;
create policy "job_attachments_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-attachments'
    and auth.uid() is not null
    and split_part(name, '/', 2) = auth.uid()::text
    and public.crea_current_user_workspace_job_access(
      nullif(split_part(name, '/', 1), '')::uuid
    )
  );
