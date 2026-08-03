type HttpErrorJson = {
  status?: number
  statusCode?: number
  ok?: boolean
}

const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504])

function extractRawMessage(error: unknown): string {
  if (error == null) return ''
  if (typeof error === 'string') return error.trim()
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message
    if (typeof m === 'string') return m.trim()
  }
  return ''
}

function messageFromHttpStatus(status: number): string | null {
  if (status === 504 || status === 503 || status === 502) {
    return 'CREA is temporarily unavailable. Please try again in a moment.'
  }
  if (status === 500) return 'Something went wrong on our servers. Please try again.'
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status === 401) return 'Session expired. Please sign in again.'
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 404) return 'That resource could not be found.'
  if (RETRYABLE_HTTP.has(status)) return 'Request failed. Please try again.'
  return null
}

function tryParseHttpErrorJson(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const obj = JSON.parse(trimmed) as HttpErrorJson
    const status =
      typeof obj.status === 'number'
        ? obj.status
        : typeof obj.statusCode === 'number'
          ? obj.statusCode
          : null
    if (status != null) return messageFromHttpStatus(status)
  } catch {
    /* not JSON */
  }
  return null
}

/** True when a failed Supabase/network call is worth retrying (gateway, offline, etc.). */
export function isRetryableSupabaseError(error: unknown): boolean {
  const raw = extractRawMessage(error)
  if (!raw) return false
  const fromJson = tryParseHttpErrorJson(raw)
  if (fromJson) {
    const trimmed = raw.trim()
    try {
      const obj = JSON.parse(trimmed) as HttpErrorJson
      const status = obj.status ?? obj.statusCode
      if (typeof status === 'number' && RETRYABLE_HTTP.has(status)) return true
    } catch {
      /* ignore */
    }
  }
  const lower = raw.toLowerCase()
  return (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('timeout') ||
    lower.includes('gateway') ||
    lower.includes('temporarily unavailable')
  )
}

/** Never surface raw JSON / huge blobs in alerts — map to short copy users can act on. */
export function userFacingErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  const raw = extractRawMessage(error)
  if (!raw) return fallback

  const fromJson = tryParseHttpErrorJson(raw)
  if (fromJson) return fromJson

  const lower = raw.toLowerCase()
  if (lower.includes('invalid login credentials')) return 'Email or password is incorrect.'
  if (lower.includes('email not confirmed')) return 'Please confirm your email before signing in.'
  if (lower.includes('user already registered')) return 'An account with this email already exists.'
  if (lower.includes('network request failed') || lower.includes('failed to fetch')) {
    return 'No connection. Check your internet and try again.'
  }
  if (lower.includes('invalid refresh token') || lower.includes('refresh token not found')) {
    return 'Your session expired. Please sign in again.'
  }
  if (lower.includes('connection pool') || lower.includes('timed out acquiring connection')) {
    return 'Database is busy right now. Please try again in a moment.'
  }

  if (raw.length > 160 || raw.includes('"headers"') || raw.includes('"url"')) {
    return fallback
  }

  return raw
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
