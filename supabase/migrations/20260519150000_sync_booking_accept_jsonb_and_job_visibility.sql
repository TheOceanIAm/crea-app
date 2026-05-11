-- Harden sync_project_member_from_booking_accept:
-- 1) Read message text via to_jsonb(subselect) so RECORD/to_jsonb and missing `body` column never break.
-- 2) Strip BOM / odd whitespace so CREA_BOOKING_JSON_V1 prefix check passes.
-- 3) Normalize openDeepLink for URL-encoded slashes before UUID parse.
-- 4) Insert job_freelancer_visibility here so freelancer can SELECT jobs (My Projects) even if trigger 191000 was skipped.

create or replace function public.sync_project_member_from_booking_accept(p_booking_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  uid uuid := auth.uid();
  m record;
  msg_js jsonb;
  c record;
  raw text;
  json_line text;
  payload jsonb;
  deep_link text;
  deep_link_norm text;
  matched text[];
  target_uuid uuid;
  p_row record;
  peer_ok boolean;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into m from public.messages where id = p_booking_message_id;
  if not found then
    raise exception 'booking message not found';
  end if;

  select to_jsonb(x) into msg_js
  from (select * from public.messages where id = p_booking_message_id) x;

  if msg_js is null then
    raise exception 'booking message not found';
  end if;

  raw := coalesce(
    nullif(trim(msg_js->>'content'), ''),
    nullif(trim(msg_js->>'body'), ''),
    ''
  );
  raw := replace(replace(replace(raw, chr(65279), ''), chr(8203), ''), chr(8288), '');
  raw := trim(both from raw);

  if raw is null or raw not like 'CREA_BOOKING_JSON_V1%' then
    raise exception 'not a booking request message';
  end if;

  json_line := trim(split_part(trim(substring(raw from length('CREA_BOOKING_JSON_V1') + 1)), E'\n', 1));
  begin
    payload := json_line::jsonb;
  exception when others then
    raise exception 'invalid booking payload';
  end;

  deep_link := nullif(trim(payload->>'openDeepLink'), '');
  if deep_link is null then
    raise exception 'booking payload missing openDeepLink';
  end if;

  deep_link_norm := replace(replace(deep_link, '%2F', '/'), '%2f', '/');

  matched := regexp_match(deep_link_norm, '(?:project|jobs)/([0-9a-fA-F-]{36})');
  if matched is null then
    matched := regexp_match(deep_link_norm, '([0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{4}-[0-9a-fA-F-]{12})');
  end if;
  if matched is null then
    raise exception 'could not parse project or job id from openDeepLink';
  end if;

  begin
    target_uuid := matched[1]::uuid;
  exception when others then
    raise exception 'invalid uuid in openDeepLink';
  end;

  select * into c from public.conversations where id = m.conversation_id;
  if not found then
    raise exception 'conversation not found';
  end if;

  peer_ok := false;
  if c.participant_1 is not null and c.participant_2 is not null then
    peer_ok :=
      (c.participant_1 = uid and c.participant_2 = m.sender_id)
      or (c.participant_2 = uid and c.participant_1 = m.sender_id);
  elsif c.participant_ids is not null then
    peer_ok :=
      (to_jsonb(c.participant_ids) @> to_jsonb(array[uid::text]))
      and (to_jsonb(c.participant_ids) @> to_jsonb(array[m.sender_id::text]))
      and m.sender_id is distinct from uid;
  end if;

  if not peer_ok then
    raise exception 'forbidden';
  end if;

  select * into p_row
  from public.projects
  where id = target_uuid or job_id = target_uuid
  limit 1;

  if not found then
    raise exception 'project not found for booking link';
  end if;

  if p_row.company_id is distinct from m.sender_id then
    raise exception 'booking sender must own the project';
  end if;

  if p_row.freelancer_id is not distinct from p_row.company_id then
    update public.projects
      set freelancer_id = uid,
          updated_at = now()
      where id = p_row.id;

    insert into public.project_members (project_id, profile_id, member_role)
    values (p_row.id, uid, 'lead')
    on conflict (project_id, profile_id) do update
      set member_role = excluded.member_role;
  else
    insert into public.project_members (project_id, profile_id, member_role)
    values (p_row.id, uid, 'crew')
    on conflict (project_id, profile_id) do nothing;
  end if;

  if p_row.job_id is not null and uid is distinct from p_row.company_id then
    insert into public.job_freelancer_visibility (job_id, freelancer_id)
    values (p_row.job_id, uid)
    on conflict (job_id, freelancer_id) do nothing;
  end if;
end;
$$;

comment on function public.sync_project_member_from_booking_accept(uuid) is
  'Booking accept: project_members + optional job_freelancer_visibility; robust message/openDeepLink parsing; SET row_security = off.';
