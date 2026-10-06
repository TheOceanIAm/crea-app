-- What the client pays the company, and the upfront needed before production starts.
-- Separate from project_budget_plans (internal cost cap) and from crew invoices.

create table if not exists public.project_client_billing (
  project_id uuid primary key references public.projects (id) on delete cascade,
  currency text not null default 'EUR',
  client_budget numeric,
  upfront_kind text not null default 'percent_50'
    check (upfront_kind in ('percent_25', 'percent_50', 'percent_75', 'paid', 'custom')),
  custom_mode text check (custom_mode in ('percent', 'amount')),
  custom_percent numeric,
  custom_amount numeric,
  received_amount numeric,
  received_at timestamptz,
  marked_by uuid references public.profiles (id) on delete set null,
  note text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.project_client_billing is
  'Client fee and upfront receipt for a project. Visible to the company account, not to freelancers.';

create table if not exists public.company_quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  client_name text not null default '',
  title text not null default '',
  currency text not null default 'EUR',
  status text not null default 'draft' check (status in ('draft', 'accepted')),
  accepted_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists company_quotes_company_idx on public.company_quotes (company_id, updated_at desc);

create table if not exists public.company_quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.company_quotes (id) on delete cascade,
  label text not null default '',
  amount numeric not null default 0,
  sort_order int not null default 0
);

create index if not exists company_quote_lines_quote_idx on public.company_quote_lines (quote_id, sort_order);

comment on table public.company_quotes is
  'Company quote drafts. Accepting a project-linked quote writes its total into project_client_billing.';

create or replace function public.crea_client_billing_can_manage(p_project_id uuid)
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
        public.auth_user_can_access_company(p.company_id)
        or public.auth_user_can_access_company(j.company_id)
      )
  );
$$;

revoke all on function public.crea_client_billing_can_manage(uuid) from public;
grant execute on function public.crea_client_billing_can_manage(uuid) to authenticated;

alter table public.project_client_billing enable row level security;
alter table public.company_quotes enable row level security;
alter table public.company_quote_lines enable row level security;

drop policy if exists "project_client_billing_select" on public.project_client_billing;
create policy "project_client_billing_select"
  on public.project_client_billing for select to authenticated
  using (public.crea_client_billing_can_manage(project_id));

drop policy if exists "project_client_billing_insert" on public.project_client_billing;
create policy "project_client_billing_insert"
  on public.project_client_billing for insert to authenticated
  with check (public.crea_client_billing_can_manage(project_id));

drop policy if exists "project_client_billing_update" on public.project_client_billing;
create policy "project_client_billing_update"
  on public.project_client_billing for update to authenticated
  using (public.crea_client_billing_can_manage(project_id))
  with check (public.crea_client_billing_can_manage(project_id));

drop policy if exists "project_client_billing_delete" on public.project_client_billing;
create policy "project_client_billing_delete"
  on public.project_client_billing for delete to authenticated
  using (public.crea_client_billing_can_manage(project_id));

drop policy if exists "company_quotes_all" on public.company_quotes;
create policy "company_quotes_all"
  on public.company_quotes for all to authenticated
  using (public.auth_user_can_access_company(company_id))
  with check (
    public.auth_user_can_access_company(company_id)
    and (project_id is null or public.crea_client_billing_can_manage(project_id))
  );

drop policy if exists "company_quote_lines_all" on public.company_quote_lines;
create policy "company_quote_lines_all"
  on public.company_quote_lines for all to authenticated
  using (
    exists (
      select 1 from public.company_quotes q
      where q.id = company_quote_lines.quote_id
        and public.auth_user_can_access_company(q.company_id)
    )
  )
  with check (
    exists (
      select 1 from public.company_quotes q
      where q.id = company_quote_lines.quote_id
        and public.auth_user_can_access_company(q.company_id)
    )
  );

grant select, insert, update, delete on public.project_client_billing to authenticated;
grant select, insert, update, delete on public.company_quotes to authenticated;
grant select, insert, update, delete on public.company_quote_lines to authenticated;

notify pgrst, 'reload schema';
