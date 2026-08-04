-- Shoot/booking days + day rates for external crew (no Crea account).
-- Same booked_dates shape as project_members (ISO string = full day, or {"date","units"}).

alter table public.project_manual_crew
  add column if not exists booked_dates jsonb default null,
  add column if not exists scheduling_start_date date,
  add column if not exists scheduling_end_date date,
  add column if not exists day_rate_amount numeric,
  add column if not exists half_day_rate_amount numeric;

comment on column public.project_manual_crew.booked_dates is
  'Shoot days for this external crew contact: array of ISO date strings (full day) or objects {"date","units"} (units ≤ 1).';

comment on column public.project_manual_crew.day_rate_amount is
  'Project-local day rate for budget (external crew has no Crea profile rates).';

comment on column public.project_manual_crew.half_day_rate_amount is
  'Optional half-day rate; when null, budget uses 0.5 × day_rate_amount.';
