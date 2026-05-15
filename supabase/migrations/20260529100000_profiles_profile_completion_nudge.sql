-- One-shot (or cooldown-controlled) profile completion reminder cron marks this when a push was sent.

alter table public.profiles add column if not exists profile_completion_nudge_sent_at timestamptz;

comment on column public.profiles.profile_completion_nudge_sent_at is
  'Set when the scheduled profile-completion reminder push was sent (crea-services cron). Cooldown via PROFILE_COMPLETION_NUDGE_COOLDOWN_DAYS env when > 0.';
