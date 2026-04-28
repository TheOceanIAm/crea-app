# Web: Brief AI → Production (Shotlist & Call Sheet)

The mobile app calls a Supabase Edge Function so Brief AI **markdown** stored on `projects.brief_ai_outputs` is converted (via OpenAI) into the **same structured rows** the Production UI already uses. Replicate this on the web so both clients write to identical tables.

## Prerequisites

- SQL from `supabase/sql/production_workspace.sql` applied (tables `production_shots`, `production_days`, RLS).
- Edge Function **`apply-brief-to-production`** deployed (`scripts/deploy-supabase.sh` includes it).
- Secret **`OPENAI_API_KEY`** set on the Supabase project (same as `brief-ai`).

## Endpoint

Invoke like any other Edge Function with the **logged-in user’s JWT** (not the service role), so RLS applies:

```http
POST https://<PROJECT_REF>.supabase.co/functions/v1/apply-brief-to-production
Authorization: Bearer <user_access_token>
Content-Type: application/json
```

## Request body

| Field | Type | Required | Notes |
|--------|------|----------|--------|
| `projectId` | string (uuid) | yes | Project id |
| `tool` | `"shotlist"` \| `"callsheet"` | yes | Must match a key in `projects.brief_ai_outputs` |
| `shootDate` | string | yes | `YYYY-MM-DD` — for shotlist: `production_shots.shoot_date`; for callsheet: `production_days.date` |
| `replaceShots` | boolean | no | **Shotlist only.** If `true`, deletes all `production_shots` for `(project_id, shoot_date)` before inserting. If `false` or omitted, **appends** new rows. Ignored for `callsheet`. |

Example (shotlist, replace day):

```json
{
  "projectId": "uuid-here",
  "tool": "shotlist",
  "shootDate": "2026-05-12",
  "replaceShots": true
}
```

Example (callsheet):

```json
{
  "projectId": "uuid-here",
  "tool": "callsheet",
  "shootDate": "2026-05-12"
}
```

## Behaviour summary

### `tool: "shotlist"`

1. Reads `projects.brief_ai_outputs.shotlist` (must be non-empty).
2. OpenAI converts markdown → JSON `{ "shots": [ { scene_nr, description, lens, location, framing, audio_notes } ] }`.
3. Inserts rows into **`production_shots`** with `status: "open"` and the given `shoot_date`.

### `tool: "callsheet"`

1. Reads `projects.brief_ai_outputs.callsheet`.
2. Loads **`project_members`** (+ profile names) for name matching.
3. OpenAI returns JSON with `entries[]`, optional `default_call_time`, `default_location`, and **`notes`** (day-wide logistics: timeline, location addresses/parking, **travel legs** with approx. distance and drive times, meals, emergency line — condensed from the Brief AI markdown).
4. Merges into **`production_days.call_sheet`** as `{ [profile_id]: { call_time?, location? } }`.
5. If no row exists for `(project_id, date)`:
   - **Company** (`projects.company_id === auth user`): **inserts** a new `production_days` row.
   - **Non-company**: HTTP **409** with hint to create the day first (or have company apply once).

Existing `production_days` rows: `call_sheet` keys are **deep-merged** per `profile_id`; optional AI `notes` are appended to `production_days.notes`.

## Success responses (JSON)

Shotlist:

```json
{ "ok": true, "tool": "shotlist", "shotsInserted": 12, "shootDate": "2026-05-12" }
```

Callsheet:

```json
{
  "ok": true,
  "tool": "callsheet",
  "date": "2026-05-12",
  "crewUpdated": 4,
  "matchedNames": 2,
  "createdDay": false
}
```

(`createdDay: true` when a new `production_days` row was inserted.)

## Error responses

- **400** — missing fields, invalid date, no saved Brief output for that tool, DB validation error.
- **401** — missing/invalid auth.
- **403** — project not visible to user.
- **409** — callsheet: no production day and caller is not company.
- **502** — OpenAI HTTP failure or unparseable JSON.

Body shape: `{ "error": "...", "hint": "..." }` when applicable.

## Saving Brief AI text on the web first

The function reads **only** `projects.brief_ai_outputs` from the database. After the user generates text on the web, persist it the same way as the app (e.g. RPC **`project_merge_brief_output`** with `p_project_id`, `p_tool`, `p_content`), or any update that merges into `brief_ai_outputs` consistently.

## Client example (browser / Next)

```ts
const { data, error } = await supabase.functions.invoke('apply-brief-to-production', {
  body: {
    projectId,
    tool: 'shotlist',
    shootDate: '2026-05-12',
    replaceShots: false,
  },
})
```

Use the same `createClient` instance that already has the user session.

## UX suggestions (match app)

- Show **date picker** `YYYY-MM-DD` (default: project schedule start or today).
- Shotlist: **Append** vs **Replace day** before calling (maps to `replaceShots`).
- Callsheet: short copy that **company** can create the first production day via apply; others need an existing day.
