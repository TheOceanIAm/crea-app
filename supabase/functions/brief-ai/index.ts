import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Body = { projectId?: string; tool?: string; context?: string | null }

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

    const { projectId, tool, context } = (await req.json()) as Body
    if (!projectId || !tool) {
      return new Response(JSON.stringify({ error: 'projectId and tool required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: proj, error: perr } = await supabase
      .from('projects')
      .select('id, title, brief_ai_context')
      .eq('id', projectId)
      .maybeSingle()

    if (perr || !proj) {
      return new Response(JSON.stringify({ error: 'Project not found or forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      return new Response(
        JSON.stringify({
          error: 'OpenAI not configured',
          hint: 'Set OPENAI_API_KEY secret for the brief-ai Edge Function',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const toolPrompts: Record<string, string> = {
      shotlist: `You are a production assistant. Output a concise shot list in Markdown for the project titled "${proj.title}". Use numbered scenes/shots where helpful.`,
      tasks: `You are a production coordinator. Output a phase-based task breakdown with owners (roles, not names) in Markdown for "${proj.title}".`,
      callsheet: `You are a 1st AD. Output a simplified one-day call sheet skeleton in Markdown for "${proj.title}" (sections: crew call, shoot windows, locations, key contacts placeholders).`,
      gear: `You are a camera department lead. Output an equipment list in Markdown categories (camera, lenses, lighting, grip, audio) for "${proj.title}".`,
      production_report: `You are a production coordinator writing the end-of-day report for "${proj.title}". Output clear Markdown: summary of what was shot, open issues, tomorrow's priorities, and any safety or logistics notes. Be specific and professional; use bullet lists where helpful.`,
    }

    const sys = toolPrompts[tool] ?? toolPrompts.tasks
    const ctx = (context ?? proj.brief_ai_context ?? '').slice(0, 12000)
    const userMsg = `Project title: ${proj.title}\n\nAdditional context from the team:\n${ctx}`

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
          { role: 'user', content: userMsg },
        ],
        temperature: 0.6,
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
    const content = completion?.choices?.[0]?.message?.content ?? ''

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
