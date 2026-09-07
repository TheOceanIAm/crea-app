-- Per-deliverable check-off for workspace milestones (company / project owner).
-- `milestones.deliverables` stays the label list; this column holds the same-order booleans.

alter table public.milestones
  add column if not exists deliverables_done jsonb not null default '[]'::jsonb;

comment on column public.milestones.deliverables_done is
  'Same order as milestones.deliverables: true when the company/project owner has checked that item off.';
