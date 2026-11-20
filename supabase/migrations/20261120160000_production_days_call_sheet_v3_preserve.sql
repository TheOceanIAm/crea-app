-- Call sheet stays version 2. locations, scenes[].time, and scenes[].location_id
-- are additive keys on that document.
-- BEFORE UPDATE only. The function adjusts NEW. It is SECURITY INVOKER
-- so it runs as the caller and does not bypass RLS.
-- Keep the retain rules in sync with retainMissingCallSheetFields in lib/call-sheet.ts.
-- Keep this file in sync with crea-services/supabase/migrations/20261120160000_production_days_call_sheet_v3_preserve.sql
--
-- An UPDATE from an older client omits locations, scenes[].time, and scenes[].location_id.
-- Those values are copied from the stored row. A key that is present, including an empty
-- array or an empty time, is left as sent.
-- Scene time and location_id are copied only when the scene label at the same index matches.
-- An incoming v of 3 is stored as 2. This trigger does not raise the version.
-- INSERT ... ON CONFLICT DO UPDATE fires this BEFORE UPDATE trigger. The app does not upsert
-- production_days today. A plain INSERT does not run this trigger.

create or replace function public.production_days_preserve_call_sheet_v3()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  old_doc jsonb;
  new_doc jsonb;
  old_scene jsonb;
  scene jsonb;
  rebuilt jsonb;
  loc jsonb;
  loc_ids text[] := array[]::text[];
  i integer;
  n integer;
  scene_label text;
  old_label text;
  time_text text;
  loc_id text;
  name_text text;
  address_text text;
  notes_text text;
  enforce boolean := false;
begin
  if new.call_sheet is null or jsonb_typeof(new.call_sheet) <> 'object' then
    return new;
  end if;

  old_doc := case
    when old.call_sheet is not null and jsonb_typeof(old.call_sheet) = 'object' then old.call_sheet
    else '{}'::jsonb
  end;
  new_doc := new.call_sheet;

  if (old_doc ? 'locations') and not (new_doc ? 'locations') then
    new_doc := jsonb_set(new_doc, '{locations}', old_doc->'locations', true);
  end if;

  if jsonb_typeof(new_doc->'scenes') = 'array' and jsonb_typeof(old_doc->'scenes') = 'array' then
    rebuilt := '[]'::jsonb;
    n := jsonb_array_length(new_doc->'scenes');
    for i in 0 .. n - 1 loop
      scene := new_doc->'scenes'->i;
      if jsonb_typeof(scene) = 'object' and i < jsonb_array_length(old_doc->'scenes') then
        old_scene := old_doc->'scenes'->i;
        if jsonb_typeof(old_scene) = 'object' then
          scene_label := coalesce(scene->>'scene', '');
          old_label := coalesce(old_scene->>'scene', '');
          if scene_label = old_label then
            if not (scene ? 'time') and (old_scene ? 'time') then
              scene := jsonb_set(scene, '{time}', old_scene->'time', true);
            end if;
            if not (scene ? 'location_id') and (old_scene ? 'location_id') then
              scene := jsonb_set(scene, '{location_id}', old_scene->'location_id', true);
            end if;
          end if;
        end if;
      end if;
      if jsonb_typeof(scene) = 'object' and ((scene ? 'time') or (scene ? 'location_id')) then
        enforce := true;
      end if;
      rebuilt := rebuilt || jsonb_build_array(scene);
    end loop;
    new_doc := jsonb_set(new_doc, '{scenes}', rebuilt, true);
  end if;

  if coalesce(new_doc->>'v', '') = '3' then
    new_doc := jsonb_set(new_doc, '{v}', '2'::jsonb, true);
  end if;

  if new_doc ? 'locations' then
    enforce := true;
  end if;

  if enforce and (new_doc ? 'locations') then
    if jsonb_typeof(new_doc->'locations') <> 'array' then
      raise exception 'Call sheet locations must be a list.'
        using errcode = '23514';
    end if;
    n := jsonb_array_length(new_doc->'locations');
    if n > 30 then
      raise exception 'A call sheet can have at most 30 locations.'
        using errcode = '23514';
    end if;
    for i in 0 .. n - 1 loop
      loc := new_doc->'locations'->i;
      if jsonb_typeof(loc) <> 'object' then
        raise exception 'Each location must be an object.'
          using errcode = '23514';
      end if;
      if coalesce(loc->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Each location needs an id.'
          using errcode = '23514';
      end if;
      name_text := coalesce(loc->>'name', '');
      address_text := coalesce(loc->>'address', '');
      notes_text := loc->>'notes';
      if char_length(name_text) > 120 then
        raise exception 'Location name is too long.'
          using errcode = '23514';
      end if;
      if char_length(address_text) > 300 then
        raise exception 'Location address is too long.'
          using errcode = '23514';
      end if;
      if notes_text is not null and char_length(notes_text) > 2000 then
        raise exception 'Location notes are too long.'
          using errcode = '23514';
      end if;
      loc_ids := loc_ids || (loc->>'id');
    end loop;
  end if;

  if enforce and jsonb_typeof(new_doc->'scenes') = 'array' then
    n := jsonb_array_length(new_doc->'scenes');
    if n > 500 then
      raise exception 'A call sheet can have at most 500 scenes.'
        using errcode = '23514';
    end if;
    rebuilt := '[]'::jsonb;
    for i in 0 .. n - 1 loop
      scene := new_doc->'scenes'->i;
      if jsonb_typeof(scene) = 'object' then
        if scene ? 'time' then
          time_text := coalesce(scene->>'time', '');
          if time_text <> '' and time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
            raise exception 'Scene time must be HH:MM.'
              using errcode = '23514';
          end if;
        end if;
        if scene ? 'location_id' and (new_doc ? 'locations') then
          loc_id := nullif(scene->>'location_id', '');
          if loc_id is not null and not (loc_id = any (loc_ids)) then
            scene := scene - 'location_id';
          end if;
        end if;
      end if;
      rebuilt := rebuilt || jsonb_build_array(scene);
    end loop;
    new_doc := jsonb_set(new_doc, '{scenes}', rebuilt, true);
  end if;

  new.call_sheet := new_doc;
  return new;
end;
$$;

comment on function public.production_days_preserve_call_sheet_v3() is
  'BEFORE UPDATE: keep call sheet locations and scene times when an older client omits them. Incoming v 3 is stored as v 2. SECURITY INVOKER.';

drop trigger if exists trg_production_days_preserve_call_sheet_v3 on public.production_days;
create trigger trg_production_days_preserve_call_sheet_v3
  before update on public.production_days
  for each row
  execute function public.production_days_preserve_call_sheet_v3();

-- Rows already stored as v 3 go back to v 2. The new trigger is in place first,
-- so this update does not get rewritten to v 3 by the previous function.
update public.production_days
set call_sheet = jsonb_set(call_sheet, '{v}', '2'::jsonb, true)
where jsonb_typeof(call_sheet) = 'object'
  and call_sheet->>'v' = '3';
