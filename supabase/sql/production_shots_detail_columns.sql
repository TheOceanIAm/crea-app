-- Extra shotlist fields (location, framing, audio). Run in Supabase SQL Editor after production_workspace.sql.

alter table public.production_shots add column if not exists location text not null default '';
alter table public.production_shots add column if not exists framing text not null default '';
alter table public.production_shots add column if not exists audio_notes text not null default '';

comment on column public.production_shots.location is 'Set / room / stage';
comment on column public.production_shots.framing is 'Shot size / intent (e.g. WS, MCU, insert)';
comment on column public.production_shots.audio_notes is 'Mic / lav / ambient notes';
