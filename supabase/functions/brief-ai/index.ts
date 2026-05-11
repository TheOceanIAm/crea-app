import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Body = {
  projectId?: string
  tool?: string
  context?: string
}

type ToolId = 'shotlist' | 'tasks' | 'callsheet' | 'gear' | 'production_report'

type ProjectRow = {
  id: string
  title: string
  status: string | null
  location: string | null
  brief_ai_context: string | null
  scheduling_start_date: string | null
  scheduling_end_date: string | null
}

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

function isModelUnsupportedError(rawText: string): boolean {
  const low = rawText.toLowerCase()
  return (
    (low.includes('model:') || low.includes('model')) &&
    (low.includes('not found') || low.includes('not supported') || low.includes('invalid') || low.includes('model:'))
  )
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

function projectContextBlock(project: ProjectRow, userContext: string): string {
  return [
    `Project: ${project.title}`,
    `Status: ${project.status ?? 'active'}`,
    `Location: ${project.location ?? 'not set'}`,
    `Schedule: ${project.scheduling_start_date ?? '—'} to ${project.scheduling_end_date ?? '—'}`,
    project.brief_ai_context?.trim() ? `Saved project context:\n${project.brief_ai_context.trim()}` : '',
    userContext.trim() ? `User input:\n${userContext.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function promptsForTool(tool: ToolId): { system: string; userLead: string } {
  if (tool === 'shotlist') {
    return {
      system:
        'You are a senior 1st AD and shot designer. Return clean Markdown only. Output ONLY a shot list, nothing else. Do NOT include production overview, synopsis, mood, concept notes, timelines, or prose sections outside shot rows. The output must be directly usable as a shooting shot list.\n\nRequired format:\n- Start with heading: "## Shot List"\n- Then one Markdown table only with these columns exactly:\n  | # | Day | Scene/Slate | Location | Time | Shot Type/Size | Camera/Movement | Lens | Framing/Action | Audio | Notes |\n- Each row must be one concrete shot.\n- In "Shot Type/Size", always write terms in full words (e.g. "Extreme Close-Up", "Medium Close-Up", "Wide Shot"), not abbreviations like ECU/MCU/WS.\n- If information is missing, write "TBD" in that cell.\n- Minimum 12 shots when context is broad, otherwise include all inferable shots.\n- Keep cells concise and practical.',
      userLead: 'Create the shot list now.',
    }
  }
  if (tool === 'tasks') {
    return {
      system:
        'You are a production manager. Return Markdown only. Output ONLY an actionable task breakdown, nothing else. Do NOT include shotlist content, creative descriptions, equipment manifests, or long narrative paragraphs.\n\nRequired format:\n- Start with heading: "## Task Breakdown"\n- Create exactly these sections and no other top-level sections:\n  - "### Prep"\n  - "### Shoot"\n  - "### Post"\n- Under each section output a Markdown checklist only, one task per line:\n  - [ ] <task> — Owner: <role> — Due: <relative timing>\n- Tasks must be concrete and executable.\n- If owner/timing is unknown, use "TBD".',
      userLead: 'Create the task breakdown now.',
    }
  }
  if (tool === 'callsheet') {
    return {
      system:
        'You are a 1st AD creating professional call sheets. Return Markdown only. Include day timeline, key locations, travel legs with rough distances/drive times when inferable, crew calls, meals, safety/emergency block, and weather assumptions. Prefer scannable tables and bullet sections.',
      userLead: 'Create a detailed call sheet in Markdown.',
    }
  }
  if (tool === 'gear') {
    return {
      system:
        'You are a line producer + DoP preparing equipment manifests. Return Markdown only. Output ONLY an equipment list, nothing else. Do NOT include task breakdown, shot descriptions, schedule summaries, creative treatment, or prose outside equipment sections.\n\nRequired format:\n- Start with heading: "## Equipment List"\n- Use only these department headings when relevant:\n  - "### Camera & Media"\n  - "### Lenses"\n  - "### Support"\n  - "### Lighting"\n  - "### Grip"\n  - "### Sound"\n  - "### Data / DIT"\n  - "### Misc"\n- Under each used heading include one Markdown table only with columns exactly:\n  | Item | Qty | Spec / Model | Purpose / Notes |\n- Each row must be one equipment item.\n- If unknown, use "TBD".',
      userLead: 'Create the equipment list now.',
    }
  }
  return {
    system:
      'You are a production coordinator writing concise end-of-day reports. Return Markdown only with clear headings, highlights, blockers, and next actions.',
    userLead: 'Create a production report in Markdown.',
  }
}

async function callClaude(opts: { apiKey: string; system: string; user: string }): Promise<string> {
  let lastErr = 'Anthropic request failed'
  let lastStatus = 500
  for (const model of anthropicModelCandidates()) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2400,
        temperature: 0.45,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      }),
    })
    if (res.ok) {
      const data = await res.json()
      return extractAnthropicText(data)
    }
    const t = await res.text()
    lastErr = t
    lastStatus = res.status
    if (!isModelUnsupportedError(t)) break
  }
  throw new Error(`Anthropic error (${lastStatus}): ${lastErr}`)
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
    }
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
        hint: 'ANTHROPIC_API_KEY appears invalid for this project. Re-set the secret and redeploy the function.',
      }
    }
    if (lower.includes('credit') || lower.includes('quota') || lower.includes('billing')) {
      return {
        message: msg,
        hint: 'Anthropic billing/quota appears exhausted. Check usage and limits.',
      }
    }
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
      return {
        message: msg,
        hint: 'Anthropic rate limit reached. Wait a moment and retry.',
      }
    }
    if (lower.includes('model')) {
      return {
        message: msg,
        hint:
          'No available Anthropic model matched this key. Set ANTHROPIC_MODEL_FALLBACKS to models enabled on your Anthropic account.',
      }
    }
    return { message: msg }
  } catch {
    return { message: t.slice(0, 700) }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
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
      data: { user: authUser },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !authUser) {
      return failJson('Unauthorized', { status: 401 })
    }

    const { projectId, tool, context } = (await req.json()) as Body
    const normalizedTool = String(tool ?? '').trim() as ToolId
    if (!projectId || !normalizedTool) {
      return failJson('projectId and tool are required', { status: 400 })
    }
    const allowed: ToolId[] = ['shotlist', 'tasks', 'callsheet', 'gear', 'production_report']
    if (!allowed.includes(normalizedTool)) {
      return failJson('Unsupported tool', { status: 400 })
    }

    const { data: project, error: projectErr } = await supabase
      .from('projects')
      .select('id, title, status, location, brief_ai_context, scheduling_start_date, scheduling_end_date')
      .eq('id', projectId)
      .maybeSingle()

    if (projectErr || !project) {
      return failJson('Project not found or forbidden', { status: 403 })
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? Deno.env.get('OPENAI_API_KEY')
    if (!anthropicKey) {
      return failJson('Anthropic not configured', {
        hint: 'Set ANTHROPIC_API_KEY (or OPENAI_API_KEY fallback) for Edge Functions',
        status: 503,
      })
    }

    const { system, userLead } = promptsForTool(normalizedTool)
    const userPrompt = `${userLead}\n\n${projectContextBlock(project as ProjectRow, context ?? '')}`
    let content = ''
    try {
      content = await callClaude({
        apiKey: anthropicKey,
        system,
        user: userPrompt.slice(0, 22000),
      })
    } catch (err) {
      const msg = String(err)
      const marker = 'Anthropic error'
      const raw = msg.includes(marker) ? msg.slice(msg.indexOf(marker)) : msg
      const summary = summarizeAnthropicError(raw)
      return failJson(summary.message, { hint: summary.hint, details: raw.slice(0, 1200), status: 502 })
    }
    if (!content.trim()) {
      return failJson('No content returned from Claude.', { status: 502 })
    }

    return okJson({ ok: true, content })
  } catch (e) {
    return failJson(String(e), { status: 500 })
  }
})
