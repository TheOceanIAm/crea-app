-- Talent pool discovery: companies/CEO + Pro/Premium freelancers read directory data.
-- Matches app logic in app/(tabs)/talent-pool.tsx. Run in Supabase SQL Editor as postgres.
--
-- JWT user_metadata.freelancer_plan: freelancers need 'pro' or 'premium' (Starter/Workspace: no pool read).
--
-- IMPORTANT: Do not use `EXISTS (SELECT … FROM profiles …)` inside an RLS policy ON `profiles`
-- — PostgreSQL reports "infinite recursion detected in policy for relation 'profiles'".
-- Use a SECURITY DEFINER helper that reads `profiles` for auth.uid() outside the policy recursion chain.

create or replace function public.talent_pool_viewer_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        coalesce(p.role, '') in ('company', 'ceo')
        or (
          coalesce(p.role, '') = 'freelancer'
          and coalesce(
            nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'freelancer_plan'), ''),
            'starter'
          ) in ('pro', 'premium')
        )
      )
  );
$$;

comment on function public.talent_pool_viewer_ok() is
  'True if the current user may browse the talent pool (company/ceo or pro/premium freelancer). Used by RLS to avoid recursive profiles policies.';

revoke all on function public.talent_pool_viewer_ok() from public;
grant execute on function public.talent_pool_viewer_ok() to authenticated;

alter table if exists public.freelancer_profiles enable row level security;
alter table if exists public.profiles enable row level security;

drop policy if exists "freelancer_profiles_select_talent_pool" on public.freelancer_profiles;
create policy "freelancer_profiles_select_talent_pool"
  on public.freelancer_profiles
  for select
  to authenticated
  using (public.talent_pool_viewer_ok());

comment on policy "freelancer_profiles_select_talent_pool" on public.freelancer_profiles is
  'Talent pool: read freelancer_profiles for companies/CEO and Pro/Premium freelancers.';

drop policy if exists "profiles_select_for_talent_pool_peers" on public.profiles;
create policy "profiles_select_for_talent_pool_peers"
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or (
      coalesce(role, '') not in ('company', 'ceo')
      and public.talent_pool_viewer_ok()
    )
  );

comment on policy "profiles_select_for_talent_pool_peers" on public.profiles is
  'Talent pool: read non-company/ceo profile rows; own row always allowed.';
