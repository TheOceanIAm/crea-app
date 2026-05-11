-- Project-specific contact overrides on crew rows (call sheets, client-side contact person).
-- Distinct from auth / profiles.email — editable by company or lead per project_members row.

alter table public.project_members
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists contact_label text;

comment on column public.project_members.contact_email is
  'Optional email for this booking / crew list (project-specific).';
comment on column public.project_members.contact_phone is
  'Optional phone for this booking / crew list (project-specific).';
comment on column public.project_members.contact_label is
  'Short line: e.g. who from the client side is the day-to-day contact on this job.';
