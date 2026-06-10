-- Booking accept: tolerate plain-text DMs, legacy «title» format, and CREA JSON on any line
-- (191500 regressed plain-text + raised "invalid booking payload" when JSON line was missing).

create or replace function public.resolve_booking_target_from_message(
  p_raw text,
  p_sender_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw text := coalesce(p_raw, '');
  json_line text;
  payload jsonb;
  deep_link text;
  deep_link_norm text;
  matched text[];
  target_uuid uuid;
  project_title text;
begin
  raw := replace(replace(replace(trim(raw), chr(65279), ''), chr(8203), ''), chr(8288), '');
  if raw = '' then
    return null;
  end if;

  if raw like 'CREA_BOOKING_JSON_V1%' then
    json_line := trim(split_part(trim(substring(raw from length('CREA_BOOKING_JSON_V1') + 1)), E'\n', 1));
    begin
      payload := json_line::jsonb;
    exception when others then
      payload := null;
    end;

    if payload is null then
      begin
        payload := (regexp_match(substring(raw from length('CREA_BOOKING_JSON_V1') + 1), '\{[\s\S]*\}'))[1]::jsonb;
      exception when others then
        payload := null;
      end;
    end if;

    if payload is not null then
      deep_link := nullif(trim(payload->>'openDeepLink'), '');
      if deep_link is not null and deep_link not in ('crea://', 'crea:///') then
        deep_link_norm := replace(replace(deep_link, '%2F', '/'), '%2f', '/');
        matched := regexp_match(deep_link_norm, '(?:project|jobs)/([0-9a-fA-F-]{36})');
        if matched is null then
          matched := regexp_match(
            deep_link_norm,
            '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'
          );
        end if;
        if matched is not null then
          begin
            return matched[1]::uuid;
          exception when others then
            null;
          end;
        end if;
      end if;

      project_title := nullif(trim(payload->>'title'), '');
      if project_title is not null then
        target_uuid := public.resolve_booking_job_id_by_title(p_sender_id, project_title);
        if target_uuid is not null then
          return target_uuid;
        end if;
      end if;
    end if;
  end if;

  if raw ~ '(?mi)^Project:\s*(.+)$' then
    project_title := trim(both from (regexp_match(raw, '(?mi)^Project:\s*(.+)$'))[1]);
    project_title := regexp_replace(project_title, '\s+', ' ', 'g');
    target_uuid := public.resolve_booking_job_id_by_title(p_sender_id, project_title);
    if target_uuid is not null then
      return target_uuid;
    end if;
  end if;

  if raw ~ 'Booking request:\s*«([^»]+)»' then
    project_title := trim(both from (regexp_match(raw, 'Booking request:\s*«([^»]+)»'))[1]);
    target_uuid := public.resolve_booking_job_id_by_title(p_sender_id, project_title);
    if target_uuid is not null then
      return target_uuid;
    end if;
  end if;

  if raw ~ '(?mi)^Booking request:\s*(.+?)\s*[\(–—-]' then
    project_title := trim(both from (regexp_match(raw, '(?mi)^Booking request:\s*(.+?)\s*[\(–—-]'))[1]);
    project_title := regexp_replace(project_title, '\s+', ' ', 'g');
    target_uuid := public.resolve_booking_job_id_by_title(p_sender_id, project_title);
    if target_uuid is not null then
      return target_uuid;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.resolve_booking_job_id_by_title(
  p_company_id uuid,
  p_title text
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  project_title text := regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g');
  target_uuid uuid;
begin
  if project_title = '' then
    return null;
  end if;

  select j.id into target_uuid
  from public.jobs j
  where j.company_id = p_company_id
    and lower(trim(j.title)) = lower(project_title)
    and j.status = 'active'
  order by j.updated_at desc nulls last, j.created_at desc
  limit 1;

  if target_uuid is null and length(project_title) >= 8 then
    select j.id into target_uuid
    from public.jobs j
    where j.company_id = p_company_id
      and j.status = 'active'
      and (
        strpos(lower(trim(j.title)), lower(project_title)) > 0
        or strpos(lower(project_title), lower(trim(j.title))) > 0
      )
    order by abs(length(trim(j.title)) - length(project_title)),
             j.updated_at desc nulls last,
             j.created_at desc
    limit 1;
  end if;

  if target_uuid is null then
    select j.id into target_uuid
    from public.jobs j
    where j.company_id = p_company_id
      and j.status = 'active'
      and length(regexp_replace(lower(project_title), '[^a-z0-9]+', '', 'g')) >= 4
      and regexp_replace(lower(trim(j.title)), '[^a-z0-9]+', '', 'g')
          = regexp_replace(lower(project_title), '[^a-z0-9]+', '', 'g')
    order by j.updated_at desc nulls last, j.created_at desc
    limit 1;
  end if;

  if target_uuid is null then
    select j.id into target_uuid
    from public.jobs j
    where j.company_id = p_company_id
      and lower(trim(j.title)) = lower(project_title)
    order by case when j.status = 'active' then 0 else 1 end,
             j.updated_at desc nulls last,
             j.created_at desc
    limit 1;
  end if;

  return target_uuid;
end;
$$;

grant execute on function public.resolve_booking_job_id_by_title(uuid, text) to authenticated;
grant execute on function public.resolve_booking_target_from_message(text, uuid) to authenticated;

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

  raw := coalesce(
    nullif(trim(msg_js->>'content'), ''),
    nullif(trim(msg_js->>'body'), ''),
    ''
  );

  target_uuid := public.resolve_booking_target_from_message(raw, m.sender_id);
  if target_uuid is null then
    raise exception 'not a booking request message';
  end if;

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
  'Booking accept: structured CREA JSON, plain Project: line, or legacy «title» — fuzzy job resolve.';

-- Reply trigger: use same resolver for booking body (plain text + JSON).
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
  reply_payload jsonb;
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

  target_uuid := public.resolve_booking_target_from_message(raw_booking, bm.sender_id);
  if target_uuid is null then
    return;
  end if;

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

notify pgrst, 'reload schema';
