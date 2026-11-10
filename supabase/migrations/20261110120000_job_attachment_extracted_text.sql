-- Text extracted from workspace documents (PDF, DOCX, plain text) so project search
-- can match inside the file. Written by the server after upload; same row visibility
-- as job_attachments. Service role updates these columns (no client update policy).

alter table public.job_attachments
  add column if not exists extracted_text text,
  add column if not exists extract_status text,
  add column if not exists extracted_at timestamptz;

comment on column public.job_attachments.extracted_text is
  'Plain text extracted for workspace search. Pages are separated with form feed (U+000C).';

comment on column public.job_attachments.extract_status is
  'null = not tried yet, then ready | empty | failed | skipped.';
