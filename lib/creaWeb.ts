import { Linking } from 'react-native'

/** Base URL for the Crea web app (Brief AI, Frame.io deep links, etc.) */
export function getCreaWebBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_CREA_WEB_URL || '').replace(/\/$/, '')
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
export function openInvoicePayOnWeb(invoiceId: string): boolean {
  const payBase = getCreaPayBaseUrl()
  const webBase = getCreaWebBaseUrl()
  const target = payBase
    ? `${payBase}/invoices/${invoiceId}`
    : webBase
      ? `${webBase}/invoices/${invoiceId}?pay=1`
      : ''
  if (!target) return false
  Linking.openURL(target).catch(() => {})
  return true
}
