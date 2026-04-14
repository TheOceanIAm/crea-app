-- Optional widgets for the public CEO profile (sports card, good news, etc.).
-- JSON shape matches lib/publicProfileWidgets.ts — omit keys to keep code defaults.

alter table public.profiles add column if not exists public_profile_widgets jsonb;

comment on column public.profiles.public_profile_widgets is 'CEO public page: { sports?, goodNews? } — see lib/publicProfileWidgets.ts';
