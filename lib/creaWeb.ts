import { Linking } from 'react-native'

/** Base URL for the Crea web app (Brief AI, Frame.io deep links, etc.) */
export function getCreaWebBaseUrl(): string {
  const raw = (process.env.EXPO_PUBLIC_CREA_WEB_URL || '').trim().replace(/\/$/, '')
  if (!raw) return ''
  // Avoid extra 307 redirect (creaservices.de -> www.creaservices.de) for mobile API calls.
  if (raw === 'https://creaservices.de') return 'https://www.creaservices.de'
  return raw
}

/**
 * HTTPS URL for Supabase email actions (signup confirm, magic link, password recovery).
 * Email apps open links in the browser — never use `crea://` here or Safari shows a blank page.
 * Must match a route allowed in Supabase → Authentication → Redirect URLs (e.g. https://www.creaservices.de/auth/confirm).
 */
export function getWebAuthConfirmRedirectUrl(): string | null {
  const base = getCreaWebBaseUrl().trim()
  if (!base) return null
  return `${base.replace(/\/$/, '')}/auth/confirm`
}

/** Open a path on the Crea web app (company contracts, invoice payment, etc.). */
export async function openCreaWebPath(path: string): Promise<boolean> {
  const base = getCreaWebBaseUrl().trim().replace(/\/$/, '')
  if (!base) return false
  const suffix = path.startsWith('/') ? path : `/${path}`
  try {
    await Linking.openURL(`${base}${suffix}`)
    return true
  } catch {
    return false
  }
}

export function openProjectOnWeb(projectId: string, path = ''): void {
  const base = getCreaWebBaseUrl()
  if (!base) {
    return
  }
  const suffix = path.startsWith('/') ? path : path ? `/${path}` : ''
  Linking.openURL(`${base}/projects/${projectId}${suffix}`).catch(() => {})
}

/** Opens invoice payment on creaservices.de (web-only). */
export async function openInvoicePayOnWeb(invoiceId: string): Promise<boolean> {
  const webBase = getCreaWebBaseUrl()
  if (!webBase) return false
  try {
    await Linking.openURL(`${webBase}/invoices/${invoiceId}?pay=1`)
    return true
  } catch {
    return false
  }
}
