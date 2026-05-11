-- Backfill for environments where booking replies were stored as plain JSON
-- (e.g. {"v":1,"forMessageId":"...","status":"accepted"}) without CREA_BOOKING_REPLY_V1 prefix.
-- Idempotent and safe to rerun.

do $$
declare
  rec record;
  p_row public.projects;
  raw_booking text;
  json_booking text;
  payload jsonb;
  reply_payload jsonb;
  matched text[];
  target_uuid uuid;
begin
  for rec in
    select
      rm.id as reply_id,
      rm.sender_id as freelancer_id,
      rm.created_at as reply_at,
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
      ) like '{"v":1,%'
    order by rm.created_at asc
  loop
    begin
      reply_payload := rec.reply_raw::jsonb;
      if (reply_payload->>'status') is distinct from 'accepted' then
        continue;
      end if;
      if coalesce(reply_payload->>'forMessageId', '') = '' then
        continue;
      end if;

      select
        bm.sender_id as company_id,
        coalesce(
          nullif(trim(to_jsonb(bm)->>'content'), ''),
          nullif(trim(to_jsonb(bm)->>'body'), ''),
          ''
        ) as booking_raw
      into rec.company_id, raw_booking
      from public.messages bm
      where bm.id = (reply_payload->>'forMessageId')::uuid
      limit 1;

      if rec.company_id is null then
        continue;
      end if;

      if raw_booking like 'CREA_BOOKING_JSON_V1%' then
        json_booking := trim(split_part(trim(substring(raw_booking from length('CREA_BOOKING_JSON_V1') + 1)), E'\n', 1));
        payload := json_booking::jsonb;
      elsif raw_booking like '{"v":1,%' then
        payload := raw_booking::jsonb;
      else
        continue;
      end if;

      matched := regexp_match(
        replace(replace(coalesce(payload->>'openDeepLink', ''), '%2F', '/'), '%2f', '/'),
        '(?:project|jobs)/([0-9a-fA-F-]{36})'
      );
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

      if p_row.job_id is not null and rec.freelancer_id is distinct from p_row.company_id then
        insert into public.job_freelancer_visibility (job_id, freelancer_id)
        values (p_row.job_id, rec.freelancer_id)
        on conflict (job_id, freelancer_id) do nothing;
      end if;

    exception
      when others then
        continue;
    end;
  end loop;
end;
$$;
