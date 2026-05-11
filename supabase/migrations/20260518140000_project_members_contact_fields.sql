-- Project-local contact line + overrides on crew membership (does not replace Supabase Auth email).

alter table public.project_members
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists works_as text;

comment on column public.project_members.contact_email is
  'Optional reach-out email for this listing (call sheets, crew modal). Distinct from auth.users email.';
comment on column public.project_members.contact_phone is
  'Optional phone for this project / crew lists.';
comment on column public.project_members.works_as is
  'One line: who this person is on this job (e.g. on-set producer, billing contact).';

alter table public.project_manual_crew
  add column if not exists works_as text;

comment on column public.project_manual_crew.works_as is
  'Optional one-line note: role on this project (manual crew without CREA account).';
