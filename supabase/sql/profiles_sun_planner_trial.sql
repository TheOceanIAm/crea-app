-- Freelancers (Workspace + Starter): first touch sets trial start for Production Sun/Weather per app rules (14 days).
-- Run in Supabase SQL Editor after deploy.

alter table public.profiles
  add column if not exists sun_planner_trial_started_at timestamptz null;

comment on column public.profiles.sun_planner_trial_started_at is
  'Freelancer Workspace: Sun + Weather trial window. Freelancer Starter: Sun Planner trial only (Weather full). Trial length enforced in app (14 days).';

-- Idempotent: sets start time once per user (COALESCE). SECURITY DEFINER so it works under typical RLS.
create or replace function public.touch_sun_planner_trial_start()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v uuid := auth.uid();
  out_ts timestamptz;
begin
  if v is null then
    return null;
  end if;

  update public.profiles
  set sun_planner_trial_started_at = coalesce(sun_planner_trial_started_at, now())
  where id = v;

  select sun_planner_trial_started_at into out_ts
  from public.profiles
  where id = v;

  return out_ts;
end;
$$;

grant execute on function public.touch_sun_planner_trial_start() to authenticated;
