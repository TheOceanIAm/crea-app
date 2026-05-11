-- Harden booking-accept auto-sync:
-- - resolve target project by job/project id first (not strict company_id equality in query)
-- - validate booking sender as a company actor for that project
-- - enforce single lead member by demoting old leads before assigning new one

create or replace function public.sync_project_member_from_booking_reply_message(p_reply_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  rm record;
  bm record;
  raw_reply text;
  raw_booking text;
  reply_line text;
  booking_line text;
  reply_payload jsonb;
  booking_payload jsonb;
  deep_link text;
  deep_link_norm text;
  matched text[];
  target_uuid uuid;
  p_row record;
  sender_is_company_actor boolean := false;
  sender_role text := '';
begin
  select * into rm from public.messages where id = p_reply_message_id;
  if not found then
    return;
  end if;

  raw_reply := coalesce(
    nullif(trim(to_jsonb(rm)->>'content'), ''),
    nullif(trim(to_jsonb(rm)->>'body'), ''),
    ''
  );
  raw_reply := replace(replace(replace(trim(raw_reply), chr(65279), ''), chr(8203), ''), chr(8288), '');
  if raw_reply = '' then
    return;
  end if;

  if raw_reply like 'CREA_BOOKING_REPLY_V1%' then
    reply_line := split_part(trim(substring(raw_reply from length('CREA_BOOKING_REPLY_V1') + 1)), E'\n', 1);
  else
    reply_line := raw_reply;
  end if;

  begin
    reply_payload := trim(reply_line)::jsonb;
  exception when others then
    return;
  end;

  if coalesce(reply_payload->>'status', '') <> 'accepted' then
    return;
  end if;
  if coalesce(reply_payload->>'forMessageId', '') = '' then
    return;
  end if;

  select * into bm
  from public.messages
  where id = (reply_payload->>'forMessageId')::uuid
    and conversation_id = rm.conversation_id
  limit 1;
  if not found then
    return;
  end if;

  raw_booking := coalesce(
    nullif(trim(to_jsonb(bm)->>'content'), ''),
    nullif(trim(to_jsonb(bm)->>'body'), ''),
    ''
  );
  raw_booking := replace(replace(replace(trim(raw_booking), chr(65279), ''), chr(8203), ''), chr(8288), '');
  if raw_booking = '' then
    return;
  end if;

  if raw_booking like 'CREA_BOOKING_JSON_V1%' then
    booking_line := split_part(trim(substring(raw_booking from length('CREA_BOOKING_JSON_V1') + 1)), E'\n', 1);
  else
    booking_line := raw_booking;
  end if;

  begin
    booking_payload := trim(booking_line)::jsonb;
  exception when others then
    return;
  end;

  deep_link := nullif(trim(booking_payload->>'openDeepLink'), '');
  if deep_link is null then
    return;
  end if;
  deep_link_norm := replace(replace(deep_link, '%2F', '/'), '%2f', '/');

  matched := regexp_match(deep_link_norm, '(?:project|jobs)/([0-9a-fA-F-]{36})');
  if matched is null then
    matched := regexp_match(deep_link_norm, '([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12})');
  end if;
  if matched is null then
    return;
  end if;
  target_uuid := matched[1]::uuid;

  select * into p_row
  from public.projects
  where id = target_uuid or job_id = target_uuid
  limit 1;
  if not found then
    return;
  end if;

  select coalesce(lower(role), '') into sender_role
  from public.profiles
  where id = bm.sender_id
  limit 1;

  sender_is_company_actor :=
    bm.sender_id = p_row.company_id
    or exists (
      select 1
      from public.project_members pm
      where pm.project_id = p_row.id
        and pm.profile_id = bm.sender_id
        and lower(coalesce(pm.member_role, '')) = 'company'
    )
    or sender_role = 'company';

  if not sender_is_company_actor then
    return;
  end if;

  if rm.sender_id is null or rm.sender_id = p_row.company_id then
    return;
  end if;

  -- First accepted freelancer becomes lead when placeholder lead is still company.
  if p_row.freelancer_id is not distinct from p_row.company_id then
    update public.projects
      set freelancer_id = rm.sender_id,
          updated_at = now()
      where id = p_row.id
        and freelancer_id is not distinct from company_id;

    update public.project_members
      set member_role = 'crew'
      where project_id = p_row.id
        and lower(coalesce(member_role, '')) = 'lead'
        and profile_id is distinct from rm.sender_id;

    insert into public.project_members (project_id, profile_id, member_role)
    values (p_row.id, rm.sender_id, 'lead')
    on conflict (project_id, profile_id) do update
      set member_role = excluded.member_role;
  else
    insert into public.project_members (project_id, profile_id, member_role)
    values (p_row.id, rm.sender_id, 'crew')
    on conflict (project_id, profile_id) do nothing;
  end if;

  if p_row.job_id is not null and rm.sender_id is distinct from p_row.company_id then
    insert into public.job_freelancer_visibility (job_id, freelancer_id)
    values (p_row.job_id, rm.sender_id)
    on conflict (job_id, freelancer_id) do nothing;
  end if;
end;
$$;

comment on function public.sync_project_member_from_booking_reply_message(uuid) is
  'Auto sync for accepted booking replies; hardened sender validation and single-lead enforcement.';

-- Re-run on historical accepted replies so older edge-cases self-heal.
do $$
declare
  r record;
begin
  for r in
    select id
    from public.messages
    where coalesce(
            nullif(trim(to_jsonb(messages)->>'content'), ''),
            nullif(trim(to_jsonb(messages)->>'body'), ''),
            ''
          ) like '%"forMessageId"%'
      and coalesce(
            nullif(trim(to_jsonb(messages)->>'content'), ''),
            nullif(trim(to_jsonb(messages)->>'body'), ''),
            ''
          ) ilike '%"status":"accepted"%'
  loop
    begin
      perform public.sync_project_member_from_booking_reply_message(r.id);
    exception when others then
      continue;
    end;
  end loop;
end;
$$;
