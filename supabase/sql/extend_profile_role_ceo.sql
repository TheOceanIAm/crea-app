-- Allow profiles.role = 'ceo' (CEO / platform owner).
-- Fixes: ERROR 23514 — violates check constraint "profiles_role_check"
--
-- Run the whole file in Supabase → SQL Editor (one run). Then set role again.

-- 1) See current check constraints on profiles (optional, for debugging)
-- select conname, pg_get_constraintdef(c.oid) as def
-- from pg_constraint c
-- join pg_class t on c.conrelid = t.oid
-- join pg_namespace n on t.relnamespace = n.oid
-- where n.nspname = 'public' and t.relname = 'profiles' and c.contype = 'c';

-- 2) Remove the old role check (name must match your DB — error said profiles_role_check)
alter table public.profiles
  drop constraint if exists profiles_role_check;

-- 3) If your column uses a Postgres ENUM and you get "invalid input value for enum",
--    uncomment and run ONCE (use your real enum type name from column data type):
-- alter type public.profile_role add value if not exists 'ceo';

-- 4) New check: text-safe (works for text/varchar; ::text also works if role is enum)
alter table public.profiles
  add constraint profiles_role_check
  check (
    role is null
    or btrim(role::text) = ''
    or lower(btrim(role::text)) in ('freelancer', 'company', 'ceo')
  );

comment on constraint profiles_role_check on public.profiles is
  'Allowed roles: freelancer, company, ceo (null/empty = unset).';
