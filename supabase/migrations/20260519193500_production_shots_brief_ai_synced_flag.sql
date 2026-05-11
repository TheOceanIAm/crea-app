alter table public.production_shots
  add column if not exists brief_ai_synced boolean not null default false;

comment on column public.production_shots.brief_ai_synced is
  'True when row was inserted from Brief AI -> Apply to Production sync.';
