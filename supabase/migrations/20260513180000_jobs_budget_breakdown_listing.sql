-- Optional production-only budget lines on public job listings (JSON array of { "label", "amount" }).
alter table public.jobs add column if not exists budget_breakdown jsonb;

comment on column public.jobs.budget_breakdown is
  'Public-facing production budget breakdown. JSON array of {label, amount}. Separate from internal Project → Budget planning.';
