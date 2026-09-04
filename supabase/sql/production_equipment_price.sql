-- Unit price on kit list items (same currency as project budget plan). Qty stays free text; budget parses a number.
alter table public.production_equipment
  add column if not exists unit_price numeric;
