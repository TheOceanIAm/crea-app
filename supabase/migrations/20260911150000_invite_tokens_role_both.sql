-- Allow vouchers that work for freelancer and company accounts (e.g. PICDROP).

alter table public.invite_tokens
  drop constraint if exists invite_tokens_role_check;

alter table public.invite_tokens
  add constraint invite_tokens_role_check
  check (role in ('freelancer', 'company', 'both'));

comment on column public.invite_tokens.role is
  'Who may redeem: freelancer, company, or both.';

notify pgrst, 'reload schema';
