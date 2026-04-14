export type PortfolioProject = { title: string; client: string; link: string }

export type NotificationDigest = 'none' | 'daily' | 'weekly'

export type NotificationSettings = {
  emailJobMatch: boolean
  emailMessage: boolean
  emailInvoicePaid: boolean
  /** Company: new applications to your jobs */
  emailNewApplication: boolean
  /** Company: freelancer submitted or updated an invoice to you */
  emailInvoiceReceived: boolean
  digest: NotificationDigest
  /** User opted in; token may be null until OS permission granted */
  pushEnabled: boolean
  pushJobMatch: boolean
  pushMessage: boolean
  pushInvoicePaid: boolean
  pushNewApplication: boolean
  pushInvoiceReceived: boolean
  expoPushToken: string | null
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  emailJobMatch: true,
  emailMessage: true,
  emailInvoicePaid: true,
  emailNewApplication: true,
  emailInvoiceReceived: true,
  digest: 'weekly',
  pushEnabled: false,
  pushJobMatch: true,
  pushMessage: true,
  pushInvoicePaid: true,
  pushNewApplication: true,
  pushInvoiceReceived: true,
  expoPushToken: null,
}

export function parseNotificationSettings(raw: unknown): NotificationSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NOTIFICATION_SETTINGS }
  const o = raw as Record<string, unknown>
  const digest = o.digest
  const d =
    digest === 'none' || digest === 'daily' || digest === 'weekly' ? digest : DEFAULT_NOTIFICATION_SETTINGS.digest
  const tokenRaw = o.expoPushToken
  const expoPushToken =
    typeof tokenRaw === 'string' && tokenRaw.trim().length > 0 ? tokenRaw.trim() : null
  return {
    emailJobMatch: Boolean(o.emailJobMatch ?? DEFAULT_NOTIFICATION_SETTINGS.emailJobMatch),
    emailMessage: Boolean(o.emailMessage ?? DEFAULT_NOTIFICATION_SETTINGS.emailMessage),
    emailInvoicePaid: Boolean(o.emailInvoicePaid ?? DEFAULT_NOTIFICATION_SETTINGS.emailInvoicePaid),
    emailNewApplication: Boolean(
      o.emailNewApplication ?? DEFAULT_NOTIFICATION_SETTINGS.emailNewApplication
    ),
    emailInvoiceReceived: Boolean(
      o.emailInvoiceReceived ?? DEFAULT_NOTIFICATION_SETTINGS.emailInvoiceReceived
    ),
    digest: d,
    pushEnabled: Boolean(o.pushEnabled ?? DEFAULT_NOTIFICATION_SETTINGS.pushEnabled),
    pushJobMatch: Boolean(o.pushJobMatch ?? DEFAULT_NOTIFICATION_SETTINGS.pushJobMatch),
    pushMessage: Boolean(o.pushMessage ?? DEFAULT_NOTIFICATION_SETTINGS.pushMessage),
    pushInvoicePaid: Boolean(o.pushInvoicePaid ?? DEFAULT_NOTIFICATION_SETTINGS.pushInvoicePaid),
    pushNewApplication: Boolean(
      o.pushNewApplication ?? DEFAULT_NOTIFICATION_SETTINGS.pushNewApplication
    ),
    pushInvoiceReceived: Boolean(
      o.pushInvoiceReceived ?? DEFAULT_NOTIFICATION_SETTINGS.pushInvoiceReceived
    ),
    expoPushToken,
  }
}

export function parsePortfolioProjects(raw: unknown): PortfolioProject[] {
  if (!Array.isArray(raw)) return []
  const out: PortfolioProject[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    out.push({
      title: String(r.title ?? ''),
      client: String(r.client ?? ''),
      link: String(r.link ?? ''),
    })
  }
  return out
}
