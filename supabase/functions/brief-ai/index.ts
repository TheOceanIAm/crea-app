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
        'You are a senior 1st AD and shot designer. Return clean Markdown only. Build a practical production-ready shot list with clear sequencing, slate/scene hints, locations, framing, camera/lens notes, audio notes, and execution details. Use tables where useful. Keep concise but complete.',
      userLead: 'Create a detailed shot list in Markdown.',
    }
  }
  if (tool === 'tasks') {
    return {
      system:
        'You are a production manager. Return Markdown only. Create a practical task breakdown grouped by phases (prep, shoot, post) with owners, due timing, dependencies, and status hints. Prefer checklists and compact tables.',
      userLead: 'Create a detailed task breakdown in Markdown.',
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
        'You are a line producer + DoP preparing equipment manifests. Return Markdown only. Build a detailed equipment list grouped by department (camera/media, lenses, support, lighting, grip, sound, data, misc). Include quantity, key specs, and notes. Prefer tables.',
      userLead: 'Create a detailed equipment list in Markdown.',
    }
  }
  return {
    system:
      'You are a production coordinator writing concise end-of-day reports. Return Markdown only with clear headings, highlights, blockers, and next actions.',
    userLead: 'Create a production report in Markdown.',
  }
}

async function callClaude(opts: { apiKey: string; system: string; user: string }): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 2400,
      temperature: 0.45,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Anthropic error (${res.status}): ${t}`)
  }
  const data = await res.json()
  return extractAnthropicText(data)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
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
      data: { user: authUser },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !authUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { projectId, tool, context } = (await req.json()) as Body
    const normalizedTool = String(tool ?? '').trim() as ToolId
    if (!projectId || !normalizedTool) {
      return new Response(JSON.stringify({ error: 'projectId and tool are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const allowed: ToolId[] = ['shotlist', 'tasks', 'callsheet', 'gear', 'production_report']
    if (!allowed.includes(normalizedTool)) {
      return new Response(JSON.stringify({ error: 'Unsupported tool' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: project, error: projectErr } = await supabase
      .from('projects')
      .select('id, title, status, location, brief_ai_context, scheduling_start_date, scheduling_end_date')
      .eq('id', projectId)
      .maybeSingle()

    if (projectErr || !project) {
      return new Response(JSON.stringify({ error: 'Project not found or forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({
          error: 'Anthropic not configured',
          hint: 'Set ANTHROPIC_API_KEY for Edge Functions',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { system, userLead } = promptsForTool(normalizedTool)
    const userPrompt = `${userLead}\n\n${projectContextBlock(project as ProjectRow, context ?? '')}`
    const content = await callClaude({
      apiKey: anthropicKey,
      system,
      user: userPrompt.slice(0, 22000),
    })
    if (!content.trim()) {
      return new Response(JSON.stringify({ error: 'No content returned from Claude.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
