-- Reference photos on a shot, shared by the website and the app.

create table if not exists public.production_shot_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  shoot_date date not null,
  shot_id text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

comment on table public.production_shot_photos is
  'Reference photos attached to one shot. The file lives in the shot-photos bucket.';

create index if not exists production_shot_photos_shot_idx
  on public.production_shot_photos (project_id, shoot_date, shot_id, created_at);

alter table public.production_shot_photos enable row level security;

drop policy if exists "production_shot_photos_select" on public.production_shot_photos;
create policy "production_shot_photos_select" on public.production_shot_photos
  for select to authenticated
  using (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_shot_photos_insert" on public.production_shot_photos;
create policy "production_shot_photos_insert" on public.production_shot_photos
  for insert to authenticated
  with check (public.user_in_project(project_id, auth.uid()));

drop policy if exists "production_shot_photos_delete" on public.production_shot_photos;
create policy "production_shot_photos_delete" on public.production_shot_photos
  for delete to authenticated
  using (public.user_in_project(project_id, auth.uid()));

alter table public.production_shot_photos replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.production_shot_photos;
    exception
      when duplicate_object then null;
    end;
  end if;
end $$;

grant select, insert, delete on public.production_shot_photos to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shot-photos',
  'shot-photos',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "shot_photos_storage_select" on storage.objects;
create policy "shot_photos_storage_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'shot-photos'
    and public.user_in_project(split_part(name, '/', 1)::uuid, auth.uid())
  );

drop policy if exists "shot_photos_storage_insert" on storage.objects;
create policy "shot_photos_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shot-photos'
    and public.user_in_project(split_part(name, '/', 1)::uuid, auth.uid())
  );

drop policy if exists "shot_photos_storage_delete" on storage.objects;
create policy "shot_photos_storage_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'shot-photos'
    and public.user_in_project(split_part(name, '/', 1)::uuid, auth.uid())
  );

notify pgrst, 'reload schema';
