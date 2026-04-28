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

function extractJsonObject(raw: string): unknown {
  const t = raw.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t)
  const s = fence ? fence[1].trim() : t
  return JSON.parse(s)
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
      return new Response(JSON.stringify({ error: 'Missing auth' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { projectId, tool, shootDate, replaceShots } = (await req.json()) as Body
    if (!projectId || !tool || !shootDate) {
      return new Response(JSON.stringify({ error: 'projectId, tool, and shootDate (YYYY-MM-DD) are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!ISO_DATE.test(shootDate)) {
      return new Response(JSON.stringify({ error: 'shootDate must be YYYY-MM-DD' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (tool !== 'shotlist' && tool !== 'callsheet') {
      return new Response(JSON.stringify({ error: 'tool must be shotlist or callsheet' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: proj, error: perr } = await supabase
      .from('projects')
      .select('id, title, company_id, brief_ai_outputs')
      .eq('id', projectId)
      .maybeSingle()

    if (perr || !proj) {
      return new Response(JSON.stringify({ error: 'Project not found or forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const outputs = (proj.brief_ai_outputs as Record<string, string> | null) ?? {}
    const markdown = (outputs[tool] ?? '').trim()
    if (!markdown) {
      return new Response(
        JSON.stringify({
          error: 'No saved Brief AI output for this tool',
          hint: 'Generate the shotlist or call sheet in Brief AI first, then apply.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      return new Response(
        JSON.stringify({
          error: 'OpenAI not configured',
          hint: 'Set OPENAI_API_KEY for Edge Functions',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (tool === 'shotlist') {
      const sys = `You convert a film/video shot list from Markdown into structured rows. Reply with ONLY valid JSON (no markdown fences), shape:
{"shots":[{"scene_nr":"","description":"","lens":"","location":"","framing":"","audio_notes":""}]}
Rules: Use empty strings for unknown fields. At most ${MAX_SHOTS} shots. Preserve order from the source.`

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: markdown.slice(0, 12000) },
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
      })

      if (!res.ok) {
        const t = await res.text()
        return new Response(JSON.stringify({ error: 'OpenAI error', details: t }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const completion = await res.json()
      const raw = completion?.choices?.[0]?.message?.content ?? ''
      let parsed: { shots?: ShotPayload[] }
      try {
        parsed = extractJsonObject(raw) as { shots?: ShotPayload[] }
      } catch {
        return new Response(JSON.stringify({ error: 'Could not parse AI response as JSON' }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const shots = Array.isArray(parsed.shots) ? parsed.shots.slice(0, MAX_SHOTS) : []
      if (shots.length === 0) {
        return new Response(JSON.stringify({ error: 'AI returned no shots' }), {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (replaceShots === true) {
        const { error: delErr } = await supabase
          .from('production_shots')
          .delete()
          .eq('project_id', projectId)
          .eq('shoot_date', shootDate)
        if (delErr) {
          return new Response(JSON.stringify({ error: delErr.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
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
        return new Response(JSON.stringify({ error: insErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ ok: true, tool: 'shotlist', shotsInserted: rows.length, shootDate }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          {
            role: 'user',
            content: `Call sheet markdown:\n${markdown.slice(0, 14000)}\n\nCrew (match "name" to entries; profile_id is for your reasoning only, do not invent ids):\n${crewLines}`,
          },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      const t = await res.text()
      return new Response(JSON.stringify({ error: 'OpenAI error', details: t }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const completion = await res.json()
    const raw = completion?.choices?.[0]?.message?.content ?? ''
    let parsed: CallsheetPayload
    try {
      parsed = extractJsonObject(raw) as CallsheetPayload
    } catch {
      return new Response(JSON.stringify({ error: 'Could not parse AI response as JSON' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      return new Response(JSON.stringify({ error: exErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const companyId = String((proj as { company_id?: string }).company_id ?? '')

    if (!existing) {
      if (user.id !== companyId) {
        return new Response(
          JSON.stringify({
            error: 'No production day for this date yet',
            hint: 'The company account must create a production day for this date (or apply from web as company), then you can re-apply.',
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
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
        return new Response(JSON.stringify({ error: insDayErr.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          ok: true,
          tool: 'callsheet',
          date: shootDate,
          crewUpdated: Object.keys(nextSheet).length,
          matchedNames: used.size,
          createdDay: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
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
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(
      JSON.stringify({
        ok: true,
        tool: 'callsheet',
        date: shootDate,
        crewUpdated: Object.keys(nextSheet).length,
        matchedNames: used.size,
        createdDay: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
