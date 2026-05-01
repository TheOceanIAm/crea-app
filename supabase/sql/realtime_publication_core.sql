-- Enable postgres_changes for messaging (live unread + banners).
-- Re-running may error if tables are already in supabase_realtime — safe to ignore that message.

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.project_messages;
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.job_applications;
alter publication supabase_realtime add table public.invoices;
alter publication supabase_realtime add table public.user_alert_reads;
