-- Host-granted budget access for one registered crew member, plus a receipt ledger.
-- Billing, invoices, call sheet, and the job listing stay on the existing host rules.
-- Keep in sync with crea-services/supabase/migrations/20261105190000_project_budget_access_and_receipts.sql

alter table public.project_members
  add column if not exists can_manage_budget boolean not null default false;

comment on column public.project_members.can_manage_budget is
  'Set only by the project host. This member may read and edit the internal budget and file receipts on this project.';

-- Host: the company on the project, or the company that owns the linked job.
-- Does not include the lead freelancer or company-team seats.
create or replace function public.crea_project_budget_is_host(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    left join public.jobs j on j.id = coalesce(p.job_id, p.id)
    where p.id = p_project_id
      and (
        p.company_id = auth.uid()
        or j.company_id = auth.uid()
      )
  );
$$;

create or replace function public.crea_project_budget_can_manage(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.crea_project_budget_is_host(p_project_id)
  or exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.profile_id = auth.uid()
      and pm.can_manage_budget
      and lower(coalesce(pm.member_role, '')) <> 'company'
  );
$$;

revoke all on function public.crea_project_budget_is_host(uuid) from public;
revoke all on function public.crea_project_budget_can_manage(uuid) from public;
grant execute on function public.crea_project_budget_is_host(uuid) to authenticated;
grant execute on function public.crea_project_budget_can_manage(uuid) to authenticated;

-- Crew can update their own row, and the lead can update every row.
-- Neither may flip budget access. The host uses crea_set_project_budget_access.
create or replace function public.trg_project_members_guard_budget_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.can_manage_budget, false)
       and not public.crea_project_budget_is_host(new.project_id) then
      new.can_manage_budget := false;
    end if;
    return new;
  end if;

  if new.can_manage_budget is distinct from old.can_manage_budget
     and not public.crea_project_budget_is_host(coalesce(new.project_id, old.project_id)) then
    raise exception 'Only the project host can change budget access'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_members_guard_budget_access on public.project_members;
create trigger trg_project_members_guard_budget_access
  before insert or update on public.project_members
  for each row
  execute function public.trg_project_members_guard_budget_access();

create or replace function public.crea_set_project_budget_access(p_member_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_role text;
begin
  select pm.project_id, pm.member_role
    into v_project, v_role
  from public.project_members pm
  where pm.id = p_member_id;

  if v_project is null then
    raise exception 'Crew member not found';
  end if;
  if not public.crea_project_budget_is_host(v_project) then
    raise exception 'Only the project host can change budget access'
      using errcode = '42501';
  end if;
  if lower(coalesce(v_role, '')) = 'company' then
    raise exception 'The project host already has budget access';
  end if;

  update public.project_members
  set can_manage_budget = coalesce(p_enabled, false)
  where id = p_member_id;
end;
$$;

revoke all on function public.crea_set_project_budget_access(uuid, boolean) from public;
grant execute on function public.crea_set_project_budget_access(uuid, boolean) to authenticated;

-- Budget rows: same operations as before, plus a host-granted crew member.
drop policy if exists "project_budget_plans_company_select" on public.project_budget_plans;
create policy "project_budget_plans_company_select" on public.project_budget_plans
  for select to authenticated
  using (public.crea_project_budget_can_manage(project_id));

drop policy if exists "project_budget_plans_company_insert" on public.project_budget_plans;
create policy "project_budget_plans_company_insert" on public.project_budget_plans
  for insert to authenticated
  with check (public.crea_project_budget_can_manage(project_id));

drop policy if exists "project_budget_plans_company_update" on public.project_budget_plans;
create policy "project_budget_plans_company_update" on public.project_budget_plans
  for update to authenticated
  using (public.crea_project_budget_can_manage(project_id))
  with check (public.crea_project_budget_can_manage(project_id));

drop policy if exists "project_budget_plans_company_delete" on public.project_budget_plans;
create policy "project_budget_plans_company_delete" on public.project_budget_plans
  for delete to authenticated
  using (public.crea_project_budget_can_manage(project_id));

drop policy if exists "project_budget_lines_company_select" on public.project_budget_lines;
create policy "project_budget_lines_company_select" on public.project_budget_lines
  for select to authenticated
  using (public.crea_project_budget_can_manage(project_id));

drop policy if exists "project_budget_lines_company_insert" on public.project_budget_lines;
create policy "project_budget_lines_company_insert" on public.project_budget_lines
  for insert to authenticated
  with check (public.crea_project_budget_can_manage(project_id));

drop policy if exists "project_budget_lines_company_update" on public.project_budget_lines;
create policy "project_budget_lines_company_update" on public.project_budget_lines
  for update to authenticated
  using (public.crea_project_budget_can_manage(project_id))
  with check (public.crea_project_budget_can_manage(project_id));

drop policy if exists "project_budget_lines_company_delete" on public.project_budget_lines;
create policy "project_budget_lines_company_delete" on public.project_budget_lines
  for delete to authenticated
  using (public.crea_project_budget_can_manage(project_id));

create table if not exists public.project_budget_receipts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  budget_line_id uuid references public.project_budget_lines (id) on delete set null,
  label text not null,
  amount numeric not null,
  currency text not null default 'EUR',
  vendor text,
  storage_path text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint project_budget_receipts_amount_positive check (amount > 0 and amount < 100000000)
);

comment on table public.project_budget_receipts is
  'Receipt filed against one budget category. Confirming it adds the amount to that line''s spent_amount.';

create index if not exists project_budget_receipts_project_idx
  on public.project_budget_receipts (project_id, created_at desc);

alter table public.project_budget_receipts enable row level security;

drop policy if exists "project_budget_receipts_select" on public.project_budget_receipts;
create policy "project_budget_receipts_select" on public.project_budget_receipts
  for select to authenticated
  using (public.crea_project_budget_can_manage(project_id));

drop policy if exists "project_budget_receipts_delete" on public.project_budget_receipts;
create policy "project_budget_receipts_delete" on public.project_budget_receipts
  for delete to authenticated
  using (public.crea_project_budget_can_manage(project_id));

grant select, delete on public.project_budget_receipts to authenticated;

-- Inserts go through crea_add_budget_receipt so spent_amount stays in step with the file.
create or replace function public.crea_add_budget_receipt(
  p_project_id uuid,
  p_label text,
  p_amount numeric,
  p_currency text,
  p_vendor text,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
  v_amount numeric;
  v_currency text;
  v_line_id uuid;
  v_spent numeric;
  v_sort int;
  v_receipt_id uuid;
  v_path text;
begin
  if not public.crea_project_budget_can_manage(p_project_id) then
    raise exception 'Not allowed to edit this budget'
      using errcode = '42501';
  end if;

  v_label := left(btrim(coalesce(p_label, '')), 80);
  if v_label = '' then
    raise exception 'Choose a category';
  end if;

  v_amount := round(p_amount, 2);
  if v_amount is null or v_amount <= 0 or v_amount >= 100000000 then
    raise exception 'Enter a valid amount';
  end if;

  v_currency := upper(left(btrim(coalesce(p_currency, 'EUR')), 8));
  if v_currency = '' then
    v_currency := 'EUR';
  end if;

  v_path := nullif(btrim(coalesce(p_storage_path, '')), '');
  if v_path is not null and split_part(v_path, '/', 1) is distinct from p_project_id::text then
    raise exception 'Invalid receipt file';
  end if;

  select l.id
    into v_line_id
  from public.project_budget_lines l
  where l.project_id = p_project_id
    and lower(btrim(l.label)) = lower(v_label)
  order by l.sort_order, l.created_at
  limit 1;

  if v_line_id is null then
    select coalesce(max(sort_order), -1) + 1
      into v_sort
    from public.project_budget_lines
    where project_id = p_project_id;

    insert into public.project_budget_lines (project_id, label, planned_amount, spent_amount, sort_order)
    values (p_project_id, v_label, 0, v_amount, coalesce(v_sort, 0))
    returning id, spent_amount into v_line_id, v_spent;
  else
    update public.project_budget_lines
    set spent_amount = round(coalesce(spent_amount, 0) + v_amount, 2)
    where id = v_line_id
    returning spent_amount into v_spent;
  end if;

  insert into public.project_budget_receipts (
    project_id, budget_line_id, label, amount, currency, vendor, storage_path, created_by
  ) values (
    p_project_id,
    v_line_id,
    v_label,
    v_amount,
    v_currency,
    nullif(left(btrim(coalesce(p_vendor, '')), 120), ''),
    v_path,
    auth.uid()
  )
  returning id into v_receipt_id;

  return jsonb_build_object(
    'id', v_receipt_id,
    'budget_line_id', v_line_id,
    'label', v_label,
    'amount', v_amount,
    'spent_amount', v_spent
  );
end;
$$;

create or replace function public.crea_delete_budget_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_line uuid;
  v_amount numeric;
  v_path text;
  v_spent numeric;
begin
  select r.project_id, r.budget_line_id, r.amount, r.storage_path
    into v_project, v_line, v_amount, v_path
  from public.project_budget_receipts r
  where r.id = p_receipt_id;

  if v_project is null then
    raise exception 'Receipt not found';
  end if;
  if not public.crea_project_budget_can_manage(v_project) then
    raise exception 'Not allowed to edit this budget'
      using errcode = '42501';
  end if;

  if v_line is not null then
    update public.project_budget_lines
    set spent_amount = greatest(0, round(coalesce(spent_amount, 0) - coalesce(v_amount, 0), 2))
    where id = v_line
    returning spent_amount into v_spent;
  end if;

  delete from public.project_budget_receipts where id = p_receipt_id;

  return jsonb_build_object(
    'budget_line_id', v_line,
    'spent_amount', v_spent,
    'storage_path', v_path
  );
end;
$$;

revoke all on function public.crea_add_budget_receipt(uuid, text, numeric, text, text, text) from public;
revoke all on function public.crea_delete_budget_receipt(uuid) from public;
grant execute on function public.crea_add_budget_receipt(uuid, text, numeric, text, text, text) to authenticated;
grant execute on function public.crea_delete_budget_receipt(uuid) to authenticated;

-- Timesheet rows feed the Current budget. A budget manager needs the same read/write the host already has.
drop policy if exists "project_timesheet_select" on public.project_timesheet_entries;
create policy "project_timesheet_select"
  on public.project_timesheet_entries
  for select to authenticated
  using (
    public.crea_timesheet_company_can_manage(project_id)
    or public.crea_project_budget_can_manage(project_id)
    or (
      profile_id = auth.uid()
      and public.user_in_project(project_id, auth.uid())
    )
  );

drop policy if exists "project_timesheet_insert" on public.project_timesheet_entries;
create policy "project_timesheet_insert"
  on public.project_timesheet_entries
  for insert to authenticated
  with check (
    public.crea_timesheet_company_can_manage(project_id)
    or public.crea_project_budget_can_manage(project_id)
    or (
      profile_id = auth.uid()
      and manual_crew_id is null
      and public.user_in_project(project_id, auth.uid())
    )
  );

drop policy if exists "project_timesheet_update" on public.project_timesheet_entries;
create policy "project_timesheet_update"
  on public.project_timesheet_entries
  for update to authenticated
  using (
    public.crea_timesheet_company_can_manage(project_id)
    or public.crea_project_budget_can_manage(project_id)
    or (
      profile_id = auth.uid()
      and public.user_in_project(project_id, auth.uid())
    )
  )
  with check (
    public.crea_timesheet_company_can_manage(project_id)
    or public.crea_project_budget_can_manage(project_id)
    or (
      profile_id = auth.uid()
      and manual_crew_id is null
      and public.user_in_project(project_id, auth.uid())
    )
  );

drop policy if exists "project_timesheet_delete" on public.project_timesheet_entries;
create policy "project_timesheet_delete"
  on public.project_timesheet_entries
  for delete to authenticated
  using (
    public.crea_timesheet_company_can_manage(project_id)
    or public.crea_project_budget_can_manage(project_id)
    or (
      profile_id = auth.uid()
      and public.user_in_project(project_id, auth.uid())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'budget-receipts',
  'budget-receipts',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.crea_budget_receipt_object_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  head text;
begin
  head := split_part(coalesce(p_name, ''), '/', 1);
  if head !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.crea_project_budget_can_manage(head::uuid);
end;
$$;

revoke all on function public.crea_budget_receipt_object_allowed(text) from public;
grant execute on function public.crea_budget_receipt_object_allowed(text) to authenticated;

drop policy if exists "budget_receipts_storage_select" on storage.objects;
create policy "budget_receipts_storage_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'budget-receipts'
    and public.crea_budget_receipt_object_allowed(name)
  );

drop policy if exists "budget_receipts_storage_insert" on storage.objects;
create policy "budget_receipts_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'budget-receipts'
    and public.crea_budget_receipt_object_allowed(name)
  );

drop policy if exists "budget_receipts_storage_delete" on storage.objects;
create policy "budget_receipts_storage_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'budget-receipts'
    and public.crea_budget_receipt_object_allowed(name)
  );

-- Budget managers need external crew day rates for the crew total. Hosts and company seats keep the existing view.
create or replace view public.project_manual_crew_readable
with (security_invoker = false)
as
select
  m.id,
  m.project_id,
  m.name,
  m.member_role,
  m.email,
  m.phone,
  m.created_by,
  m.created_at,
  m.updated_at,
  m.works_as,
  m.booked_dates,
  m.scheduling_start_date,
  m.scheduling_end_date,
  case
    when public.crea_user_is_project_host(m.project_id)
      or public.crea_project_budget_can_manage(m.project_id) then m.day_rate_amount
    else null
  end as day_rate_amount,
  case
    when public.crea_user_is_project_host(m.project_id)
      or public.crea_project_budget_can_manage(m.project_id) then m.half_day_rate_amount
    else null
  end as half_day_rate_amount,
  m.claimed_profile_id,
  m.claimed_at
from public.project_manual_crew m
where public.user_in_project(m.project_id, auth.uid());

comment on view public.project_manual_crew_readable is
  'project_manual_crew for clients; day rates visible to the host, company seats, and host-granted budget managers.';

notify pgrst, 'reload schema';
