import { supabaseTimestampMs } from '@/lib/supabaseTimestamp'

/**
 * Structured DM payloads for availability booking requests + freelancer accept/decline.
 * Wire format: magic prefix + single-line JSON (easy to parse, stable for inbox preview overrides).
 */

export const BOOKING_DM_PREFIX = 'CREA_BOOKING_JSON_V1'
export const BOOKING_REPLY_PREFIX = 'CREA_BOOKING_REPLY_V1'

export type BookingDmPayloadV1 = {
  v: 1
  title: string
  isoStartDate: string
  isoEndDate: string
  selectedIsoDates: string[]
  userMessage?: string
  openDeepLink: string
}

export type BookingDmReplyV1 = {
  v: 1
  forMessageId: string
  status: 'accepted' | 'declined'
}

export function formatBookingDmBody(payload: BookingDmPayloadV1): string {
  return `${BOOKING_DM_PREFIX}\n${JSON.stringify(payload)}`
}

export function formatBookingReplyBody(reply: BookingDmReplyV1, humanLine: string): string {
  return `${BOOKING_REPLY_PREFIX}\n${JSON.stringify(reply)}\n\n${humanLine}`
}

export function parseBookingDm(raw: string): BookingDmPayloadV1 | null {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t) return null
  if (t.startsWith(BOOKING_DM_PREFIX)) {
    const rest = t.slice(BOOKING_DM_PREFIX.length).trimStart().replace(/^\n+/, '')
    const line = rest.split(/\r?\n/)[0] ?? ''
    try {
      const o = JSON.parse(line) as BookingDmPayloadV1
      if (o?.v === 1 && typeof o.title === 'string' && o.openDeepLink) return o
    } catch {
      return null
    }
    return null
  }
  const webCal = parsePublicCalendarBookingDm(t)
  if (webCal) return webCal
  return parseLegacyBookingDm(t)
}

/**
 * Web public profile calendar booking (`crea-services` FreelancerPublicCalendar): plain-text body.
 * Accept/decline sync resolves the job server-side from `Project:` line + message sender.
 */
function parsePublicCalendarBookingDm(t: string): BookingDmPayloadV1 | null {
  const trimmed = t.trim()
  const headerRe =
    /^Booking request:\s*(.+?)\s*[–—-]\s*(.+?)\s*\(\s*\d+\s+days?\s*\)/im
  const hm = trimmed.match(headerRe)
  if (!hm) return null

  const dLow = parseEnglishDayMonthYear(hm[1])
  const dHigh = parseEnglishDayMonthYear(hm[2])
  if (!dLow || !dHigh) return null

  const pm = trimmed.match(/^Project:\s*(.+)$/m)
  const title = pm?.[1]?.trim()
  if (!title) return null

  const start = dLow <= dHigh ? dLow : dHigh
  const end = dLow <= dHigh ? dHigh : dLow
  const isoStartDate = toIsoDateOnly(start)
  const isoEndDate = toIsoDateOnly(end)

  const selectedIsoDates: string[] = []
  const cursor = new Date(`${isoStartDate}T12:00:00`)
  const stop = new Date(`${isoEndDate}T12:00:00`)
  while (cursor <= stop) {
    selectedIsoDates.push(toIsoDateOnly(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  let userMessage: string | undefined
  if (pm.index !== undefined) {
    const after = trimmed.slice(pm.index + pm[0].length).trim()
    if (after.length > 0) userMessage = after
  }

  return {
    v: 1,
    title,
    isoStartDate,
    isoEndDate,
    selectedIsoDates,
    userMessage,
    openDeepLink: 'crea://',
  }
}

const ENGLISH_MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
}

function parseEnglishDayMonthYear(part: string): Date | null {
  const s = part.trim().replace(/\s+/g, ' ')
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (!m) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const day = parseInt(m[1], 10)
  const monWord = m[2].toLowerCase()
  const year = parseInt(m[3], 10)
  let month = ENGLISH_MONTHS[monWord]
  if (month === undefined) {
    month = ENGLISH_MONTHS[monWord.slice(0, 3)] as number | undefined
  }
  if (month === undefined || Number.isNaN(day) || Number.isNaN(year)) return null
  const d = new Date(year, month, day)
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null
  return d
}

/** Older plain-text booking DMs (pre structured wire format). */
function parseLegacyBookingDm(t: string): BookingDmPayloadV1 | null {
  const titleM = t.match(/Booking request:\s*«([^»]+)»/)
  if (!titleM) return null
  const title = titleM[1]?.trim() || 'Project'

  const linkM = t.match(/Open context:\s*(\S+)/m)
  const openDeepLink = linkM ? linkM[1].trim() : 'crea://'

  const rangeM = t.match(/Range:\s*(\d{4}-\d{2}-\d{2})\s*(?:→|->)\s*(\d{4}-\d{2}-\d{2})/)
  const singleRange = t.match(/Range:\s*(\d{4}-\d{2}-\d{2})\s*\(/)

  let isoStartDate = ''
  let isoEndDate = ''
  const selectedIsoDates: string[] = []

  if (rangeM) {
    isoStartDate = rangeM[1]
    isoEndDate = rangeM[2]
    const a = new Date(`${isoStartDate}T12:00:00`)
    const b = new Date(`${isoEndDate}T12:00:00`)
    if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
      const c = new Date(a)
      while (c <= b) {
        selectedIsoDates.push(toIsoDateOnly(c))
        c.setDate(c.getDate() + 1)
      }
    }
  } else if (singleRange) {
    isoStartDate = singleRange[1]
    isoEndDate = singleRange[1]
    selectedIsoDates.push(isoStartDate)
  } else {
    const bullets = [...t.matchAll(/•\s*(\d{4}-\d{2}-\d{2})/g)].map((x) => x[1])
    if (bullets.length > 0) {
      selectedIsoDates.push(...bullets)
      isoStartDate = bullets[0]
      isoEndDate = bullets[bullets.length - 1]
    }
  }

  if (!isoStartDate) isoStartDate = new Date().toISOString().slice(0, 10)
  if (!isoEndDate) isoEndDate = isoStartDate

  const msgM = t.match(/Message:\s*([\s\S]+?)(?=Open context:|$)/i)
  const userMessage = msgM ? msgM[1].trim() : undefined

  return {
    v: 1,
    title,
    isoStartDate,
    isoEndDate,
    selectedIsoDates: selectedIsoDates.length > 0 ? Array.from(new Set(selectedIsoDates)).sort() : [isoStartDate],
    userMessage: userMessage || undefined,
    openDeepLink,
  }
}

function toIsoDateOnly(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseBookingReply(raw: string): BookingDmReplyV1 | null {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t) return null
  const line = t.startsWith(BOOKING_REPLY_PREFIX)
    ? t.slice(BOOKING_REPLY_PREFIX.length).trimStart().replace(/^\n+/, '').split(/\r?\n/)[0] ?? ''
    : t
  try {
    const o = JSON.parse(line) as BookingDmReplyV1
    if (o?.v === 1 && o.forMessageId && (o.status === 'accepted' || o.status === 'declined')) return o
  } catch {
    return null
  }
  return null
}

export type BookingReplyStatus = 'accepted' | 'declined'

export function findBookingReplyStatus(
  rows: ReadonlyArray<{ id: string; sender_id: string; created_at: string; body?: string; content?: string; message?: string }>,
  bookingMessageId: string,
  responderId: string
): BookingReplyStatus | null {
  const booking = rows.find((r) => r.id === bookingMessageId)
  if (!booking) return null
  const t0 = supabaseTimestampMs(booking.created_at)
  for (const r of rows) {
    if (r.sender_id !== responderId) continue
    if (supabaseTimestampMs(r.created_at) <= t0) continue
    const txt = r.body ?? r.content ?? r.message ?? ''
    const rep = parseBookingReply(typeof txt === 'string' ? txt : '')
    if (rep?.forMessageId === bookingMessageId) return rep.status
  }
  return null
}

export function bookingOpenDeepLinkMatchesJob(openDeepLink: string, jobId: string): boolean {
  const j = (jobId || '').trim()
  const u = (openDeepLink || '').trim()
  if (!u || !j) return false
  const jl = j.toLowerCase()
  try {
    const normalized = u.replace(/^crea:\/\//i, 'http://hl/')
    const url = new URL(normalized)
    const path = url.pathname.replace(/^\/+/, '')
    if (path.startsWith('jobs/')) {
      const idFromPath = path.slice('jobs/'.length).split('/')[0]?.trim()
      if (idFromPath && idFromPath.toLowerCase() === jl) return true
    }
  } catch {
    /* fall through */
  }
  const lower = u.toLowerCase()
  return lower.includes(`jobs/${jl}`) || lower.includes(`jobs%2f${jl}`)
}

export function bookingInboxPreview(payload: BookingDmPayloadV1): string {
  const a = payload.isoStartDate
  const b = payload.isoEndDate
  const range = a === b ? a : `${a} – ${b}`
  const t = payload.title.trim() || 'Project'
  return `Booking request: ${t} (${range})`
}

/** Conversation list / last_message preview for structured DMs */
export function messagePreviewForInbox(raw: string): string {
  const t = typeof raw === 'string' ? raw.trim() : ''
  const reply = parseBookingReply(t)
  if (reply) {
    const tail = t.split(/\n\n/).slice(1).join('\n\n').trim()
    if (tail) return tail
    return reply.status === 'accepted' ? 'Booking accepted' : 'Booking declined'
  }
  const booking = parseBookingDm(t)
  if (booking) return bookingInboxPreview(booking)
  return t
}
