import { Linking } from 'react-native'

/** Base URL for the Crea web app (Brief AI, Frame.io deep links, etc.) */
export function getCreaWebBaseUrl(): string {
  const raw = (process.env.EXPO_PUBLIC_CREA_WEB_URL || '').trim().replace(/\/$/, '')
  if (!raw) return ''
  // Avoid extra 307 redirect (creaservices.de -> www.creaservices.de) for mobile API calls.
  if (raw === 'https://creaservices.de') return 'https://www.creaservices.de'
  return raw
}

export function openProjectOnWeb(projectId: string, path = ''): void {
  const base = getCreaWebBaseUrl()
  if (!base) {
    return
  }
  const suffix = path.startsWith('/') ? path : path ? `/${path}` : ''
  Linking.openURL(`${base}/projects/${projectId}${suffix}`).catch(() => {})
}

/** Optional override for dedicated payment route, otherwise falls back to web invoice detail. */
export function getCreaPayBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_CREA_PAY_URL || '').replace(/\/$/, '')
}

/** Opens CREA Pay for a specific invoice in the web app. */
export async function openInvoicePayOnWeb(invoiceId: string): Promise<boolean> {
  const payBase = getCreaPayBaseUrl()
  const webBase = getCreaWebBaseUrl()
  const target = payBase
    ? `${payBase}/invoices/${invoiceId}`
    : webBase
      ? `${webBase}/invoices/${invoiceId}?pay=1`
      : ''
  if (!target) return false
  try {
    await Linking.openURL(target)
    return true
  } catch {
    return false
  }
}

/** Opens CREA Pay with Apple Pay preselection hint (handled by web if supported). */
export async function openInvoiceApplePayOnWeb(invoiceId: string): Promise<boolean> {
  const payBase = getCreaPayBaseUrl()
  const webBase = getCreaWebBaseUrl()
  const target = payBase
    ? `${payBase}/invoices/${invoiceId}?method=apple_pay`
    : webBase
      ? `${webBase}/invoices/${invoiceId}?pay=1&method=apple_pay`
      : ''
  if (!target) return false
  try {
    await Linking.openURL(target)
    return true
  } catch {
    return false
  }
}
