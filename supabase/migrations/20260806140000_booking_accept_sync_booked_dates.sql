-- On booking accept: copy requested shoot days from the booking DM into
-- project_members.booked_dates (+ scheduling range) so Budget picks them up
-- without a manual Crew-tab re-entry.

create or replace function public.booking_booked_dates_from_message(p_raw text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  raw text := coalesce(p_raw, '');
  json_line text;
  payload jsonb;
  dates jsonb := '[]'::jsonb;
  elem text;
  d_start date;
  d_end date;
  d_cur date;
  iso text;
  matched text[];
  bullet text;
begin
  raw := replace(replace(replace(trim(raw), chr(65279), ''), chr(8203), ''), chr(8288), '');
  if raw = '' then
    return null;
  end if;

  -- Structured CREA booking JSON
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
      if jsonb_typeof(payload->'selectedIsoDates') = 'array'
         and jsonb_array_length(payload->'selectedIsoDates') > 0 then
        for elem in
          select jsonb_array_elements_text(payload->'selectedIsoDates')
        loop
          iso := left(trim(elem), 10);
          if iso ~ '^\d{4}-\d{2}-\d{2}$' then
            dates := dates || to_jsonb(iso);
          end if;
        end loop;
      end if;

      if jsonb_array_length(dates) = 0 then
        begin
          d_start := nullif(trim(payload->>'isoStartDate'), '')::date;
          d_end := nullif(trim(payload->>'isoEndDate'), '')::date;
        exception when others then
          d_start := null;
          d_end := null;
        end;
        if d_start is not null then
          if d_end is null or d_end < d_start then
            d_end := d_start;
          end if;
          d_cur := d_start;
          while d_cur <= d_end loop
            iso := to_char(d_cur, 'YYYY-MM-DD');
            dates := dates || to_jsonb(iso);
            d_cur := d_cur + 1;
          end loop;
        end if;
      end if;
    end if;
  end if;

  -- Legacy plain-text: Range: YYYY-MM-DD → YYYY-MM-DD
  if jsonb_array_length(dates) = 0 then
    matched := regexp_match(raw, 'Range:\s*(\d{4}-\d{2}-\d{2})\s*(?:→|->)\s*(\d{4}-\d{2}-\d{2})');
    if matched is not null then
      begin
        d_start := matched[1]::date;
        d_end := matched[2]::date;
        if d_end < d_start then
          d_cur := d_start;
          d_start := d_end;
          d_end := d_cur;
        end if;
        d_cur := d_start;
        while d_cur <= d_end loop
          iso := to_char(d_cur, 'YYYY-MM-DD');
          dates := dates || to_jsonb(iso);
          d_cur := d_cur + 1;
        end loop;
      exception when others then
        null;
      end;
    else
      matched := regexp_match(raw, 'Range:\s*(\d{4}-\d{2}-\d{2})\s*\(');
      if matched is not null then
        dates := dates || to_jsonb(matched[1]);
      end if;
    end if;
  end if;

  -- Legacy bullets: • YYYY-MM-DD
  if jsonb_array_length(dates) = 0 then
    for bullet in
      select (regexp_matches(raw, '•\s*(\d{4}-\d{2}-\d{2})', 'g'))[1]
    loop
      if bullet is not null then
        dates := dates || to_jsonb(bullet);
      end if;
    end loop;
  end if;

  if jsonb_array_length(dates) = 0 then
    return null;
  end if;

  -- Sort ascending for stable min/max / UI
  select coalesce(jsonb_agg(to_jsonb(x) order by x), '[]'::jsonb)
    into dates
  from (
    select distinct left(trim(value), 10) as x
    from jsonb_array_elements_text(dates) as t(value)
    where left(trim(value), 10) ~ '^\d{4}-\d{2}-\d{2}$'
  ) s;

  if dates is null or jsonb_array_length(dates) = 0 then
    return null;
  end if;
  return dates;
end;
$$;

comment on function public.booking_booked_dates_from_message(text) is
  'Parse shoot days from a booking DM (CREA JSON selectedIsoDates / range, or legacy plain-text).';

create or replace function public.apply_booking_dates_to_project_member(
  p_project_id uuid,
  p_profile_id uuid,
  p_booking_raw text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_dates jsonb;
  v_start date;
  v_end date;
begin
  if p_project_id is null or p_profile_id is null then
    return;
  end if;

  v_dates := public.booking_booked_dates_from_message(p_booking_raw);
  if v_dates is null or jsonb_array_length(v_dates) = 0 then
    return;
  end if;

  select min(x::date), max(x::date)
    into v_start, v_end
  from jsonb_array_elements_text(v_dates) as t(x);

  update public.project_members
  set
    booked_dates = v_dates,
    scheduling_start_date = v_start,
    scheduling_end_date = v_end
  where project_id = p_project_id
    and profile_id = p_profile_id;
end;
$$;

comment on function public.apply_booking_dates_to_project_member(uuid, uuid, text) is
  'Write booking shoot days onto project_members for Budget/Crew (full-day ISO strings).';

grant execute on function public.booking_booked_dates_from_message(text) to authenticated;
grant execute on function public.apply_booking_dates_to_project_member(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Accept RPC (client calls this on accept)
-- ---------------------------------------------------------------------------
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

  perform public.apply_booking_dates_to_project_member(p_row.id, uid, raw);

  if p_row.job_id is not null and uid is distinct from p_row.company_id then
    insert into public.job_freelancer_visibility (job_id, freelancer_id)
    values (p_row.job_id, uid)
    on conflict (job_id, freelancer_id) do nothing;
  end if;
end;
$$;

comment on function public.sync_project_member_from_booking_accept(uuid) is
  'Booking accept: add crew/lead and copy booking shoot days into project_members.booked_dates.';

-- ---------------------------------------------------------------------------
-- Reply-message trigger path
-- ---------------------------------------------------------------------------
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

  perform public.apply_booking_dates_to_project_member(p_row.id, rm.sender_id, raw_booking);

  if p_row.job_id is not null and rm.sender_id is distinct from p_row.company_id then
    insert into public.job_freelancer_visibility (job_id, freelancer_id)
    values (p_row.job_id, rm.sender_id)
    on conflict (job_id, freelancer_id) do nothing;
  end if;
end;
$$;

comment on function public.sync_project_member_from_booking_reply_message(uuid) is
  'On accepted booking reply: add crew/lead and copy booking shoot days into booked_dates.';

-- ---------------------------------------------------------------------------
-- Backfill: accepted bookings whose member row still has empty booked_dates
-- ---------------------------------------------------------------------------
do $$
declare
  rec record;
  raw_booking text;
  booking_sender uuid;
  reply_payload jsonb;
  reply_raw text;
  reply_line text;
  target_uuid uuid;
  p_row record;
  v_dates jsonb;
begin
  for rec in
    select
      rm.id as reply_id,
      rm.sender_id as freelancer_id,
      rm.conversation_id,
      coalesce(
        nullif(trim(to_jsonb(rm)->>'content'), ''),
        nullif(trim(to_jsonb(rm)->>'body'), ''),
        ''
      ) as reply_raw
    from public.messages rm
    where coalesce(
        nullif(trim(to_jsonb(rm)->>'content'), ''),
        nullif(trim(to_jsonb(rm)->>'body'), ''),
        ''
      ) like '%"status":"accepted"%'
    order by rm.created_at asc
  loop
    begin
      reply_raw := replace(replace(replace(trim(rec.reply_raw), chr(65279), ''), chr(8203), ''), chr(8288), '');
      if reply_raw like 'CREA_BOOKING_REPLY_V1%' then
        reply_line := split_part(trim(substring(reply_raw from length('CREA_BOOKING_REPLY_V1') + 1)), E'\n', 1);
      else
        reply_line := reply_raw;
      end if;

      begin
        reply_payload := trim(reply_line)::jsonb;
      exception when others then
        continue;
      end;

      if coalesce(reply_payload->>'status', '') <> 'accepted' then
        continue;
      end if;
      if coalesce(reply_payload->>'forMessageId', '') = '' then
        continue;
      end if;

      select
        coalesce(
          nullif(trim(to_jsonb(bm)->>'content'), ''),
          nullif(trim(to_jsonb(bm)->>'body'), ''),
          ''
        ),
        bm.sender_id
      into raw_booking, booking_sender
      from public.messages bm
      where bm.id = (reply_payload->>'forMessageId')::uuid
        and bm.conversation_id = rec.conversation_id
      limit 1;

      if raw_booking is null or raw_booking = '' then
        continue;
      end if;

      target_uuid := public.resolve_booking_target_from_message(raw_booking, booking_sender);
      if target_uuid is null then
        continue;
      end if;

      select * into p_row
      from public.projects
      where id = target_uuid or job_id = target_uuid
      limit 1;
      if not found then
        continue;
      end if;

      -- Only fill when still empty (do not overwrite host edits)
      if exists (
        select 1
        from public.project_members pm
        where pm.project_id = p_row.id
          and pm.profile_id = rec.freelancer_id
          and (
            pm.booked_dates is null
            or jsonb_typeof(pm.booked_dates) <> 'array'
            or jsonb_array_length(pm.booked_dates) = 0
          )
      ) then
        v_dates := public.booking_booked_dates_from_message(raw_booking);
        if v_dates is not null then
          perform public.apply_booking_dates_to_project_member(
            p_row.id,
            rec.freelancer_id,
            raw_booking
          );
        end if;
      end if;
    exception when others then
      continue;
    end;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
