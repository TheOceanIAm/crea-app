-- Inclusive date range on a project → freelancer public calendar shows those days as busy.
-- Run before public_share_rpcs.sql / profile_share_public updates.

alter table public.projects add column if not exists scheduling_start_date date;
alter table public.projects add column if not exists scheduling_end_date date;

comment on column public.projects.scheduling_start_date is
  'Inclusive first day of booked work; aggregated into profile_share_public.calendar_busy_dates.';
comment on column public.projects.scheduling_end_date is
  'Inclusive last day of booked work; must be >= scheduling_start_date when both set.';
