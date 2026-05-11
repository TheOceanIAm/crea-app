-- One-time backfill: booking invites accepted before sync_project_member_from_booking_accept existed.
-- Idempotent: ON CONFLICT / checks skip rows already synced.

do $$
declare
  rec record;
  p_row public.projects;
  raw_booking text;
  raw_reply text;
  json_booking text;
  json_reply text;
  payload jsonb;
  reply_payload jsonb;
  matched text[];
  target_uuid uuid;
  for_id text;
  reply_status text;
begin
  for rec in
    select
      bm.id as booking_id,
      bm.sender_id as company_id,
      bm.created_at as booking_at,
      coalesce(
        nullif(trim(to_jsonb(bm)->>'content'), ''),
        nullif(trim(to_jsonb(bm)->>'body'), ''),
        ''
      ) as booking_raw,
      rm.id as reply_id,
      rm.sender_id as freelancer_id,
      rm.created_at as reply_at,
      coalesce(
        nullif(trim(to_jsonb(rm)->>'content'), ''),
        nullif(trim(to_jsonb(rm)->>'body'), ''),
        ''
      ) as reply_raw
    from public.messages bm
    inner join public.messages rm
      on rm.conversation_id = bm.conversation_id
      and rm.created_at > bm.created_at
      and rm.sender_id is distinct from bm.sender_id
      and coalesce(
        nullif(trim(to_jsonb(rm)->>'content'), ''),
        nullif(trim(to_jsonb(rm)->>'body'), ''),
        ''
      ) like '%' || bm.id::text || '%'
    where coalesce(
        nullif(trim(to_jsonb(bm)->>'content'), ''),
        nullif(trim(to_jsonb(bm)->>'body'), ''),
        ''
      ) like 'CREA_BOOKING_JSON_V1%'
      and coalesce(
        nullif(trim(to_jsonb(rm)->>'content'), ''),
        nullif(trim(to_jsonb(rm)->>'body'), ''),
        ''
      ) like 'CREA_BOOKING_REPLY_V1%'
    order by rm.created_at asc
  loop
    begin
      raw_booking := rec.booking_raw;
      raw_reply := rec.reply_raw;

      json_booking := trim(
        split_part(
          trim(substring(raw_booking from length('CREA_BOOKING_JSON_V1') + 1)),
          E'\n',
          1
        )
      );
      payload := json_booking::jsonb;

      json_reply := trim(
        split_part(
          trim(substring(raw_reply from length('CREA_BOOKING_REPLY_V1') + 1)),
          E'\n',
          1
        )
      );
      reply_payload := json_reply::jsonb;

      for_id := reply_payload->>'forMessageId';
      reply_status := reply_payload->>'status';

      if reply_status is distinct from 'accepted' then
        continue;
      end if;
      if for_id is null or for_id::uuid is distinct from rec.booking_id then
        continue;
      end if;

      matched := regexp_match(coalesce(payload->>'openDeepLink', ''), '(?:project|jobs)/([0-9a-fA-F-]{36})');
      if matched is null then
        continue;
      end if;
      target_uuid := matched[1]::uuid;

      select * into p_row
      from public.projects
      where (id = target_uuid or job_id = target_uuid)
        and company_id = rec.company_id
      limit 1;

      if not found then
        continue;
      end if;

      if p_row.freelancer_id is not distinct from p_row.company_id then
        update public.projects
          set freelancer_id = rec.freelancer_id,
              updated_at = now()
          where id = p_row.id
            and freelancer_id is not distinct from company_id;

        insert into public.project_members (project_id, profile_id, member_role)
        values (p_row.id, rec.freelancer_id, 'lead')
        on conflict (project_id, profile_id) do update
          set member_role = excluded.member_role;
      else
        insert into public.project_members (project_id, profile_id, member_role)
        values (p_row.id, rec.freelancer_id, 'crew')
        on conflict (project_id, profile_id) do nothing;
      end if;

    exception
      when others then
        continue;
    end;
  end loop;
end;
$$;
