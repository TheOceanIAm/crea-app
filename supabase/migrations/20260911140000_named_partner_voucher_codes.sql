-- Named partner vouchers (e.g. PICDROP) may be redeemed by more than one user.
-- max_redemptions null = unlimited; 1 = personal single-use (default). Existing rows get 1.

alter table public.invite_tokens
  add column if not exists max_redemptions integer default 1;

alter table public.invite_tokens
  add column if not exists redemption_count integer not null default 0;

alter table public.invite_tokens
  drop constraint if exists invite_tokens_max_redemptions_check;

alter table public.invite_tokens
  add constraint invite_tokens_max_redemptions_check
  check (max_redemptions is null or max_redemptions >= 1);

alter table public.invite_tokens
  drop constraint if exists invite_tokens_redemption_count_check;

alter table public.invite_tokens
  add constraint invite_tokens_redemption_count_check
  check (redemption_count >= 0);

comment on column public.invite_tokens.code is
  'Human-typed voucher code (CREA-7K2P-9MQW or a named code such as PICDROP).';

comment on column public.invite_tokens.max_redemptions is
  'How many distinct users may redeem. Null = unlimited. 1 = personal single-use.';

comment on column public.invite_tokens.redemption_count is
  'Distinct users who have redeemed this code.';

create table if not exists public.invite_token_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_token_id uuid not null references public.invite_tokens (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (invite_token_id, user_id)
);

create index if not exists invite_token_redemptions_token_idx
  on public.invite_token_redemptions (invite_token_id);

alter table public.invite_token_redemptions enable row level security;

comment on table public.invite_token_redemptions is
  'One row per user who redeemed a voucher; service role writes at claim time.';

notify pgrst, 'reload schema';
