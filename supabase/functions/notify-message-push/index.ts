/**
 * Sends a remote push via Expo when someone receives a new DM (works when recipient’s app is closed).
 * SUPABASE_SERVICE_ROLE_KEY is provided automatically on hosted Supabase.
 * EXPO_ACCESS_TOKEN is optional: Expo accepts unauthenticated push sends by default; add the secret if you enable
 * “enhanced push security” on expo.dev (then requests without Bearer token fail with UNAUTHORIZED).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type NotificationSettings = {
  pushEnabled?: boolean
  pushMessage?: boolean
  expoPushToken?: string | null
}

function messageBody(row: Record<string, unknown>): string {
  const raw = row.body ?? row.content ?? row.message
  return typeof raw === 'string' ? raw : ''
}

function parseNotif(raw: unknown): NotificationSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  /** Missing keys treated as opted-in (legacy rows often only stored expoPushToken + pushEnabled). */
  return {
    expoPushToken: typeof o.expoPushToken === 'string' ? o.expoPushToken : undefined,
    pushEnabled: o.pushEnabled !== false,
    pushMessage: o.pushMessage !== false,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN') ?? ''

  if (!serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !anonKey) {
    return new Response(JSON.stringify({ error: 'Missing auth' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: uerr,
  } = await userClient.auth.getUser()
  if (uerr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: { messageId?: string }
  try {
    body = (await req.json()) as { messageId?: string }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : ''
  if (!messageId) {
    return new Response(JSON.stringify({ error: 'messageId required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const admin = createClient(supabaseUrl, serviceKey)
  const { data: msg, error: merr } = await admin.from('messages').select('*').eq('id', messageId).maybeSingle()
  if (merr || !msg || typeof msg !== 'object') {
    return new Response(JSON.stringify({ error: 'Message not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const row = msg as Record<string, unknown>
  const senderId = row.sender_id
  if (senderId !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const conversationId = typeof row.conversation_id === 'string' ? row.conversation_id : ''
  if (!conversationId) {
    return new Response(JSON.stringify({ error: 'Invalid message' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: convo, error: cerr } = await admin
    .from('conversations')
    .select('participant_1, participant_2')
    .eq('id', conversationId)
    .maybeSingle()
  if (cerr || !convo) {
    return new Response(JSON.stringify({ error: 'Conversation not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const p1 = convo.participant_1 as string
  const p2 = convo.participant_2 as string
  if (p1 !== user.id && p2 !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const recipientId = p1 === user.id ? p2 : p2 === user.id ? p1 : ''
  if (!recipientId || recipientId === user.id) {
    return new Response(JSON.stringify({ error: 'Invalid conversation' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: recipientProfile, error: perr } = await admin
    .from('profiles')
    .select('name, notification_settings')
    .eq('id', recipientId)
    .maybeSingle()
  if (perr || !recipientProfile) {
    return new Response(JSON.stringify({ skipped: true, reason: 'no_profile' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const settings = parseNotif(recipientProfile.notification_settings)
  const rawTok = typeof settings.expoPushToken === 'string' ? settings.expoPushToken.trim() : ''
  const pushToken =
    rawTok.length > 0 &&
    (rawTok.includes('ExponentPushToken') || rawTok.includes('ExpoPushToken'))
      ? rawTok
      : null

  if (!settings.pushEnabled || !settings.pushMessage || !pushToken) {
    return new Response(JSON.stringify({ skipped: true, reason: 'push_disabled_or_no_token' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: senderProfile } = await admin.from('profiles').select('name').eq('id', user.id).maybeSingle()
  const senderName = (senderProfile?.name as string | undefined)?.trim() || 'Crea'
  const text = messageBody(row)
  const preview = text.length > 140 ? `${text.slice(0, 137)}…` : text

  const pushHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (expoToken) {
    pushHeaders.Authorization = `Bearer ${expoToken}`
  }

  const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: pushHeaders,
    body: JSON.stringify({
      to: pushToken,
      title: senderName,
      body: preview || 'New message',
      sound: 'default',
      priority: 'high',
      data: {
        type: 'message',
        conversationId,
      },
    }),
  })

  const pushJson = (await pushRes.json().catch(() => ({}))) as { data?: { status?: string }[]; errors?: unknown[] }
  if (!pushRes.ok) {
    return new Response(JSON.stringify({ error: 'Expo push failed', detail: pushJson }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, ticket: pushJson }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
