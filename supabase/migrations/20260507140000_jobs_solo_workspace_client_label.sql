-- Optional end-client label for private (solo workspace) jobs — listing thumbnail stays the owner's avatar.

alter table public.jobs
  add column if not exists solo_workspace_client_label text;

comment on column public.jobs.solo_workspace_client_label is
  'Optional label for the real-world client on private solo workspace jobs (My Projects subtitle). Does not replace the owner avatar on cards.';
