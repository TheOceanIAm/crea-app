-- Minimal project for QA (Brief AI, Production, EXPO_PUBLIC_DEMO_PROJECT_ID).
-- Run in Supabase SQL Editor after profiles exist.
--
-- Prefers: first company profile + first freelancer profile (different users).
-- If that fails, use the commented INSERT at the bottom with two real UUIDs from:
--   select id, name, role from public.profiles order by created_at desc limit 20;

insert into public.projects (
  job_id,
  company_id,
  freelancer_id,
  title,
  status,
  budget_currency,
  milestones_completed,
  milestones_total,
  brief_ai_context
)
select
  null,
  c.id,
  f.id,
  'QA — Test project',
  'in_progress',
  'EUR',
  0,
  1,
  'Short test brief for Brief AI.'
from (
  select id from public.profiles where lower(trim(coalesce(role::text, ''))) = 'company' limit 1
) c
cross join (
  select id from public.profiles where lower(trim(coalesce(role::text, ''))) = 'freelancer' limit 1
) f
where c.id is not null
  and f.id is not null
  and c.id <> f.id
returning id, title, company_id, freelancer_id;

-- If the INSERT above inserts 0 rows: you need at least one company and one freelancer profile
-- (two different users). Create them via Auth + app register, or paste two UUIDs here:
--
-- insert into public.projects (job_id, company_id, freelancer_id, title, status, budget_currency, milestones_completed, milestones_total, brief_ai_context)
-- values (
--   null,
--   'PASTE_COMPANY_PROFILE_UUID'::uuid,
--   'PASTE_FREELANCER_PROFILE_UUID'::uuid,
--   'QA — Test project',
--   'in_progress',
--   'EUR',
--   0,
--   1,
--   'Short test brief for Brief AI.'
-- )
-- returning id, title;
--
-- Then set EXPO_PUBLIC_DEMO_PROJECT_ID to the returned `id`.
