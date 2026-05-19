-- Person info (app): crew may update their own project_members row (contact_label, contact_email, contact_phone).
-- Complements project_members_update_lead (company / lead freelancer).

drop policy if exists "project_members_update_self" on public.project_members;
create policy "project_members_update_self" on public.project_members
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

comment on policy "project_members_update_self" on public.project_members is
  'Crew can update their own row (e.g. job contact fields in Person info).';
