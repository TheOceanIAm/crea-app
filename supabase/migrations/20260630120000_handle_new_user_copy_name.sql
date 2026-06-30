-- Copy the signup display name into public.profiles.name.
--
-- The original handle_new_user_profile trigger only set id/email/role/beta_invite,
-- so profiles.name stayed NULL and public freelancer/company profiles showed the
-- "Freelancer" placeholder even though auth.users.raw_user_meta_data->>'name'
-- (the Supabase "Display name") was set at signup.

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r text;
  beta boolean;
  nm text;
begin
  r := lower(trim(coalesce(new.raw_user_meta_data->>'role', '')));
  if r not in ('freelancer', 'company') then
    r := 'freelancer';
  end if;

  beta := false;
  if new.raw_user_meta_data ? 'beta_invite' then
    beta :=
      (new.raw_user_meta_data->>'beta_invite') in ('true', 't', '1')
      or (new.raw_user_meta_data->'beta_invite') = 'true'::jsonb;
  end if;

  nm := nullif(btrim(coalesce(
    new.raw_user_meta_data->>'name',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'display_name',
    ''
  )), '');

  insert into public.profiles (id, email, role, beta_invite, name)
  values (new.id, new.email, r, beta, nm)
  on conflict (id) do update set
    email = excluded.email,
    role = excluded.role,
    beta_invite = excluded.beta_invite,
    -- Don't clobber a name the user has already set in their profile.
    name = coalesce(nullif(btrim(profiles.name), ''), excluded.name);

  return new;
end;
$$;

comment on function public.handle_new_user_profile() is
  'Inserts/updates public.profiles on auth.users insert, including the signup display name.';

-- One-time backfill: fill missing profiles.name from auth metadata.
update public.profiles p
set name = coalesce(
  nullif(btrim(u.raw_user_meta_data->>'name'), ''),
  nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
  nullif(btrim(u.raw_user_meta_data->>'display_name'), '')
)
from auth.users u
where u.id = p.id
  and (p.name is null or btrim(p.name) = '')
  and coalesce(
    nullif(btrim(u.raw_user_meta_data->>'name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'display_name'), '')
  ) is not null;
