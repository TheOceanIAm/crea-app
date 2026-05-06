-- Allow freelancers to create invoices for completed solo-workspace jobs (no job_application row).
do $migration$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'invoices'
      and policyname = 'invoices_insert_freelancer_solo_workspace_completed'
  ) then
    create policy "invoices_insert_freelancer_solo_workspace_completed"
      on public.invoices
      for insert
      to authenticated
      with check (
        freelancer_id = auth.uid()
        and company_id = auth.uid()
        and exists (
          select 1
          from public.jobs j
          where j.id = job_id
            and j.company_id = auth.uid()
            and coalesce(j.is_solo_workspace, false) = true
            and (j.project_status = 'completed' or j.status = 'closed')
        )
      );
  end if;
end
$migration$;
