-- Supabase SQL Editor: einmal ausführen (ergänzt Profil / Einstellungen wie in der App).
-- Voraussetzung: Tabelle public.profiles existiert.

alter table public.profiles add column if not exists headline text;
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists skills text[] default '{}';
alter table public.profiles add column if not exists equipment text[] default '{}';
alter table public.profiles add column if not exists avatar_url text;

comment on column public.profiles.headline is 'Jobtitel / Rolle unter dem Namen';
comment on column public.profiles.location is 'z. B. Berlin, Deutschland';
comment on column public.profiles.bio is 'Kurzbeschreibung öffentliches Profil';
comment on column public.profiles.skills is 'Skill-Tags für Matching & Profil';
comment on column public.profiles.equipment is 'Ausstattung, Lizenzen, Zertifikate';
comment on column public.profiles.avatar_url is 'Öffentliche URL zum Profilbild';
