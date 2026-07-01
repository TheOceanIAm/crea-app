-- When budget-tab targets are saved, mirror total_budget into jobs/projects listing fields.

create or replace function public.trg_project_budget_plans_sync_listing_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j_id uuid;
  cur text;
  amt numeric;
  btype text;
begin
  cur := coalesce(nullif(trim(new.currency), ''), 'EUR');
  amt := new.total_budget;
  btype := case when amt is not null then 'fixed' else 'negotiable' end;

  update public.projects
  set
    budget_amount = amt,
    budget_type = btype,
    budget_currency = cur,
    updated_at = now()
  where id = new.project_id;

  select p.job_id into j_id
  from public.projects p
  where p.id = new.project_id;

  if j_id is null then
    j_id := new.project_id;
  end if;

  update public.jobs j
  set
    budget_amount = amt,
    budget_type = btype,
    budget_currency = cur,
    updated_at = now()
  from public.projects p
  where j.id = j_id
    and p.id = new.project_id
    and j.company_id = p.company_id;

  return new;
end;
$$;

drop trigger if exists trg_project_budget_plans_sync_listing_budget on public.project_budget_plans;
create trigger trg_project_budget_plans_sync_listing_budget
  after insert or update of total_budget, currency on public.project_budget_plans
  for each row
  execute function public.trg_project_budget_plans_sync_listing_budget();

comment on function public.trg_project_budget_plans_sync_listing_budget() is
  'Mirrors project_budget_plans.total_budget into jobs/projects listing budget fields for project overview cards.';

-- Backfill existing budget-tab values into listing fields.
update public.projects p
set
  budget_amount = bp.total_budget,
  budget_type = case when bp.total_budget is not null then 'fixed' else p.budget_type end,
  budget_currency = coalesce(nullif(trim(bp.currency), ''), coalesce(p.budget_currency, 'EUR')),
  updated_at = now()
from public.project_budget_plans bp
where bp.project_id = p.id
  and bp.total_budget is not null
  and (
    p.budget_amount is null
    or coalesce(p.budget_type, 'negotiable') = 'negotiable'
  );

update public.jobs j
set
  budget_amount = bp.total_budget,
  budget_type = 'fixed',
  budget_currency = coalesce(nullif(trim(bp.currency), ''), coalesce(j.budget_currency, 'EUR')),
  updated_at = now()
from public.project_budget_plans bp
join public.projects p on p.id = bp.project_id
where bp.total_budget is not null
  and (j.id = p.job_id or j.id = p.id)
  and j.company_id = p.company_id
  and (
    j.budget_amount is null
    or coalesce(j.budget_type, 'negotiable') = 'negotiable'
  );
