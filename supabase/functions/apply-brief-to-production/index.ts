import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Body = {
  projectId?: string
  tool?: string
  shootDate?: string
  /** When true, deletes all `production_shots` for this project+date before inserting. */
  replaceShots?: boolean
}

const MAX_SHOTS = 60
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_ANTHROPIC_MODELS = [
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-latest',
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-3-haiku-20240307',
]

function anthropicModelCandidates(): string[] {
  const fromSingle = (Deno.env.get('ANTHROPIC_MODEL') ?? '').trim()
  if (fromSingle) return [fromSingle]
  const fromList = (Deno.env.get('ANTHROPIC_MODEL_FALLBACKS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (fromList.length > 0) return fromList
  return DEFAULT_ANTHROPIC_MODELS
}

async function callAnthropicMessages(opts: {
  apiKey: string
  maxTokens: number
  temperature: number
  system: string
  messages: Array<{ role: string; content: string }>
}): Promise<{ ok: true; data: unknown } | { ok: false; status: number; text: string }> {
  let lastStatus = 0
  let lastText = ''
  for (const model of anthropicModelCandidates()) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        system: opts.system,
        messages: opts.messages,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      return { ok: true, data }
    }
    const t = await res.text()
    lastStatus = res.status
    lastText = t
    const low = t.toLowerCase()
    const modelUnsupported =
      (low.includes('model:') || low.includes('model')) &&
      (low.includes('not found') || low.includes('not supported') || low.includes('invalid') || low.includes('model:'))
    if (!modelUnsupported) {
      return { ok: false, status: res.status, text: t }
    }
  }
  return { ok: false, status: lastStatus || 502, text: lastText || 'No Anthropic model candidate succeeded.' }
}

function okJson(payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function failJson(error: string, opts?: { hint?: string; status?: number; details?: string }) {
  return new Response(
    JSON.stringify({
      ok: false,
      error,
      ...(opts?.hint ? { hint: opts.hint } : {}),
      ...(opts?.details ? { details: opts.details } : {}),
      ...(opts?.status ? { status: opts.status } : {}),
    }),
    {
      // Keep HTTP 200 so mobile client can always parse structured error body.
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}

function summarizeAnthropicError(rawText: string): { message: string; hint?: string } {
  const t = rawText.trim()
  if (!t) return { message: 'Anthropic request failed' }
  try {
    const parsed = JSON.parse(t) as {
      error?: { message?: string }
      message?: string
    }
    const msg = parsed?.error?.message?.trim() || parsed?.message?.trim() || 'Anthropic request failed'
    const lower = msg.toLowerCase()
    if (lower.includes('invalid') && lower.includes('api key')) {
      return {
        message: msg,
        hint: 'ANTHROPIC_API_KEY appears invalid for this project. Re-set secret and redeploy the function.',
      }
    }
    if (lower.includes('credit') || lower.includes('quota') || lower.includes('billing')) {
      return {
        message: msg,
        hint: 'Anthropic billing/quota appears exhausted. Check your Anthropic usage and limits.',
      }
    }
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
      return {
        message: msg,
        hint: 'Anthropic rate limit reached. Wait a moment and retry.',
      }
    }
    return { message: msg }
  } catch {
    return { message: t.slice(0, 600) }
  }
}

function extractJsonObject(raw: string): unknown {
  const t = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t)
  const s = fence ? fence[1].trim() : t
  try {
    return JSON.parse(s)
  } catch {
    // Some model responses wrap JSON with extra prose. Try the first JSON object span.
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const candidate = s.slice(start, end + 1)
      return JSON.parse(candidate)
    }
    throw new Error('Could not extract JSON object')
  }
}

function extractAnthropicText(payload: unknown): string {
  const content = (payload as { content?: Array<{ type?: string; text?: string }> })?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((x) => x && x.type === 'text' && typeof x.text === 'string')
    .map((x) => x.text ?? '')
    .join('\n')
    .trim()
}

type ShotPayload = {
  scene_nr?: string
  description?: string
  lens?: string
  location?: string
  framing?: string
  audio_notes?: string
}

type CallsheetPayload = {
  entries?: { name?: string; call_time?: string; location?: string }[]
  default_call_time?: string
  default_location?: string
  notes?: string
}

function normalizeShotRow(s: ShotPayload) {
  return {
    scene_nr: String(s.scene_nr ?? '').slice(0, 200),
    description: String(s.description ?? '').slice(0, 4000),
    lens: String(s.lens ?? '').slice(0, 500),
    location: String(s.location ?? '').slice(0, 500),
    framing: String(s.framing ?? '').slice(0, 500),
    audio_notes: String(s.audio_notes ?? '').slice(0, 2000),
  }
}

function normalizeName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function matchCrewCalls(
  entries: { name?: string; call_time?: string; location?: string }[],
  members: { profile_id: string; name: string }[]
) {
  const used = new Set<string>()
  const out: Record<string, { call_time?: string; location?: string }> = {}
  for (const e of entries) {
    const rawName = (e.name ?? '').trim()
    if (!rawName) continue
    const en = normalizeName(rawName)
    const parts = en.split(' ').filter(Boolean)
    const first = parts[0] ?? ''
    const m = members.find((x) => {
      if (used.has(x.profile_id)) return false
      const xn = normalizeName(x.name)
      if (!xn) return false
      if (xn === en || xn.includes(en) || en.includes(xn)) return true
      if (first && (xn.startsWith(first) || xn.split(' ')[0] === first)) return true
      return false
    })
    if (m) {
      used.add(m.profile_id)
      out[m.profile_id] = {
        call_time: (e.call_time ?? '').trim() || undefined,
        location: (e.location ?? '').trim() || undefined,
      }
    }
  }
  return { map: out, used }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return failJson('Missing auth', { status: 401 })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
      error: uerr,
    } = await supabase.auth.getUser()
    if (uerr || !user) {
      return failJson('Unauthorized', { status: 401 })
    }

    const { projectId, tool, shootDate, replaceShots } = (await req.json()) as Body
    if (!projectId || !tool || !shootDate) {
      return failJson('projectId, tool, and shootDate (YYYY-MM-DD) are required', { status: 400 })
    }
    if (!ISO_DATE.test(shootDate)) {
      return failJson('shootDate must be YYYY-MM-DD', { status: 400 })
    }
    if (tool !== 'shotlist' && tool !== 'callsheet') {
      return failJson('tool must be shotlist or callsheet', { status: 400 })
    }

    const { data: proj, error: perr } = await supabase
      .from('projects')
      .select('id, title, company_id, brief_ai_outputs')
      .eq('id', projectId)
      .maybeSingle()

    if (perr || !proj) {
      return failJson('Project not found or forbidden', { status: 403 })
    }

    const outputs = (proj.brief_ai_outputs as Record<string, string> | null) ?? {}
    const markdown = (outputs[tool] ?? '').trim()
    if (!markdown) {
      return failJson('No saved Brief AI output for this tool', {
        hint: 'Generate the shotlist or call sheet in Brief AI first, then apply.',
        status: 400,
      })
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? Deno.env.get('OPENAI_API_KEY')
    if (!anthropicKey) {
      return failJson('Anthropic not configured', {
        hint: 'Set ANTHROPIC_API_KEY (or OPENAI_API_KEY fallback) for Edge Functions',
        status: 503,
      })
    }

    if (tool === 'shotlist') {
      const sys = `You convert a film/video shot list from Markdown into structured rows. Reply with ONLY valid JSON (no markdown fences), shape:
{"shots":[{"scene_nr":"","description":"","lens":"","location":"","framing":"","audio_notes":""}]}
Rules: Use empty strings for unknown fields. At most ${MAX_SHOTS} shots. Preserve order from the source.`

      const ai = await callAnthropicMessages({
        apiKey: anthropicKey,
        maxTokens: 2400,
        temperature: 0.2,
        system: `${sys}\n\nOutput ONLY JSON. No markdown fences.`,
        messages: [{ role: 'user', content: markdown.slice(0, 12000) }],
      })
      if (!ai.ok) {
        const t = ai.text
        const s = summarizeAnthropicError(t)
        return failJson(s.message, { hint: s.hint, details: t.slice(0, 1200), status: ai.status || 502 })
      }

      const completion = ai.data
      const raw = extractAnthropicText(completion)
      let parsed: { shots?: ShotPayload[] }
      try {
        parsed = extractJsonObject(raw) as { shots?: ShotPayload[] }
      } catch {
        return failJson('Could not parse AI response as JSON', { status: 502 })
      }
      const shots = Array.isArray(parsed.shots) ? parsed.shots.slice(0, MAX_SHOTS) : []
      if (shots.length === 0) {
        return failJson('AI returned no shots', { status: 422 })
      }

      if (replaceShots === true) {
        const { error: delErr } = await supabase
          .from('production_shots')
          .delete()
          .eq('project_id', projectId)
          .eq('shoot_date', shootDate)
        if (delErr) {
          return failJson(delErr.message, { status: 400 })
        }
      }

      const rows = shots.map((s) => ({
        project_id: projectId,
        shoot_date: shootDate,
        status: 'open' as const,
        ...normalizeShotRow(s),
      }))

      const { error: insErr } = await supabase.from('production_shots').insert(rows)
      if (insErr) {
        return failJson(insErr.message, { status: 400 })
      }

      return okJson({ ok: true, tool: 'shotlist', shotsInserted: rows.length, shootDate })
    }

    // callsheet
    const { data: memRows, error: merr } = await supabase
      .from('project_members')
      .select('profile_id, member_role, profiles(name)')
      .eq('project_id', projectId)

    if (merr) {
      return new Response(JSON.stringify({ error: merr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const members: { profile_id: string; name: string }[] = (memRows ?? []).map((r: Record<string, unknown>) => {
      const pid = String(r.profile_id ?? '')
      const prof = r.profiles as { name?: string | null } | { name?: string | null }[] | null | undefined
      const p = Array.isArray(prof) ? prof[0] : prof
      const name = (p?.name ?? '').trim() || 'Member'
      return { profile_id: pid, name }
    })

    const crewLines = members.map((m, i) => `${i + 1}. ${m.name}`).join('\n')

    const sys = `You convert a call sheet from Markdown into JSON for a known crew list. Reply with ONLY valid JSON (no markdown fences), shape:
{"entries":[{"name":"string matching a crew person","call_time":"HH:MM","location":""}],"default_call_time":"","default_location":"","notes":""}

Rules:
- entries: match names to the crew list; call_time and location are per person when the markdown differentiates (e.g. staggered calls). location may include address + short parking note in one string.
- default_call_time / default_location: use when the sheet gives one crew report time or one base for everyone.
- notes (REQUIRED if the markdown contains them — never omit): copy and condense into plain text (no JSON inside notes) the parts of the markdown that are NOT per-person overrides: full **day timeline** with times, **location list** with addresses/parking, **travel legs** (from → to, approx distance, drive times normal vs rush if stated, suggested depart times), meals/catering window, cast vs crew timing if present, emergency/hospital line, weather line. Aim for dense, scannable paragraphs or bullet lines; max about 9000 characters in notes. If the markdown has no extra logistics, notes may be empty string.`

    const ai = await callAnthropicMessages({
      apiKey: anthropicKey,
      maxTokens: 3000,
      temperature: 0.2,
      system: `${sys}\n\nOutput ONLY JSON. No markdown fences.`,
      messages: [
        {
          role: 'user',
          content: `Call sheet markdown:\n${markdown.slice(0, 14000)}\n\nCrew (match "name" to entries; profile_id is for your reasoning only, do not invent ids):\n${crewLines}`,
        },
      ],
    })

    if (!ai.ok) {
      const t = ai.text
      const s = summarizeAnthropicError(t)
      return failJson(s.message, { hint: s.hint, details: t.slice(0, 1200), status: ai.status || 502 })
    }

    const completion = ai.data
    const raw = extractAnthropicText(completion)
    let parsed: CallsheetPayload
    try {
      parsed = extractJsonObject(raw) as CallsheetPayload
    } catch {
      return failJson('Could not parse AI response as JSON', { status: 502 })
    }

    const entries = Array.isArray(parsed.entries) ? parsed.entries : []
    const { map: matched, used } = matchCrewCalls(entries, members)

    const defCall = (parsed.default_call_time ?? '').trim()
    const defLoc = (parsed.default_location ?? '').trim()
    const nextSheet: Record<string, { call_time?: string; location?: string }> = {}

    for (const m of members) {
      const hit = matched[m.profile_id]
      if (hit?.call_time || hit?.location) {
        nextSheet[m.profile_id] = { ...hit }
        continue
      }
      if (defCall || defLoc) {
        nextSheet[m.profile_id] = {
          ...(defCall ? { call_time: defCall } : {}),
          ...(defLoc ? { location: defLoc } : {}),
        }
      }
    }

    const notesAi = (parsed.notes ?? '').trim().slice(0, 12000)

    const { data: existing, error: exErr } = await supabase
      .from('production_days')
      .select('id, call_sheet, notes')
      .eq('project_id', projectId)
      .eq('date', shootDate)
      .maybeSingle()

    if (exErr) {
      return failJson(exErr.message, { status: 400 })
    }

    const companyId = String((proj as { company_id?: string }).company_id ?? '')

    if (!existing) {
      if (user.id !== companyId) {
        return failJson('No production day for this date yet', {
          hint: 'The company account must create a production day for this date (or apply from web as company), then you can re-apply.',
          status: 409,
        })
      }
      const mergedNotes = notesAi
      const { error: insDayErr } = await supabase.from('production_days').insert({
        project_id: projectId,
        date: shootDate,
        wrap_time: null,
        notes: mergedNotes || '',
        call_sheet: nextSheet,
      })
      if (insDayErr) {
        return failJson(insDayErr.message, { status: 400 })
      }
      return okJson({
        ok: true,
        tool: 'callsheet',
        date: shootDate,
        crewUpdated: Object.keys(nextSheet).length,
        matchedNames: used.size,
        createdDay: true,
      })
    }

    const prevSheet = (existing.call_sheet as Record<string, { call_time?: string; location?: string }>) ?? {}
    const mergedSheet: Record<string, { call_time?: string; location?: string }> = { ...prevSheet }
    for (const [pid, patch] of Object.entries(nextSheet)) {
      mergedSheet[pid] = { ...(prevSheet[pid] ?? {}), ...patch }
    }

    let mergedNotes = (existing.notes as string | null) ?? ''
    if (notesAi) {
      mergedNotes = mergedNotes.trim()
        ? `${mergedNotes.trim()}\n\n— Brief AI (call sheet)\n${notesAi}`
        : notesAi
    }

    const { error: upErr } = await supabase
      .from('production_days')
      .update({ call_sheet: mergedSheet, notes: mergedNotes })
      .eq('id', existing.id)

    if (upErr) {
      return failJson(upErr.message, { status: 400 })
    }

    return okJson({
      ok: true,
      tool: 'callsheet',
      date: shootDate,
      crewUpdated: Object.keys(nextSheet).length,
      matchedNames: used.size,
      createdDay: false,
    })
  } catch (e) {
    return failJson(String(e), { status: 500 })
  }
})
