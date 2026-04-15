export type PortfolioProject = {
  title: string
  client: string
  link: string
  role?: string
  /** Optional thumbnail for web/app portfolio grid */
  image_url?: string
}

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

/** Normalize user- or CMS-pasted URLs (incl. // and www-only) for Linking.openURL. */
function normalizeExternalVideoUrl(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('//')) return `https:${t}`
  if (/^(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\b/i.test(t)) {
    return `https://${t.replace(/^\/+/, '')}`
  }
  return t
}

function titleFromUrl(url: string): string {
  const u = normalizeExternalVideoUrl(url)
  if (!u) return 'Project'
  try {
    const parsed = new URL(u)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host.includes('youtube') || host.includes('youtu.be')) return 'YouTube'
    if (host.includes('vimeo')) return 'Vimeo'
    const parts = parsed.pathname.split('/').filter(Boolean)
    const last = parts[parts.length - 1]
    if (last && last.length < 48) {
      return decodeURIComponent(last).replace(/[-_+]/g, ' ').replace(/\.[^.]+$/, '') || 'Project'
    }
  } catch {
    /* ignore */
  }
  return 'Video'
}

/** Web / CMS portfolio rows often use embed or vendor-specific keys instead of `link`. */
function extractProjectLink(r: Record<string, unknown>): string {
  const keys = [
    'link',
    'url',
    'href',
    'src',
    'video_url',
    'videoUrl',
    'embed_url',
    'embedUrl',
    'embed',
    'youtube_url',
    'youtubeUrl',
    'vimeo_url',
    'vimeoUrl',
    'watch_url',
    'watchUrl',
    'uri',
    'source',
    'web_url',
    'webUrl',
    'permalink',
  ] as const
  for (const k of keys) {
    const v = r[k]
    if (typeof v === 'string' && v.trim()) {
      const n = normalizeExternalVideoUrl(v)
      if (n && (n.startsWith('http') || n.startsWith('//'))) return n.startsWith('//') ? `https:${n}` : n
    }
  }
  return ''
}

export function parsePortfolioProjects(raw: unknown): PortfolioProject[] {
  if (raw == null) return []
  let list: unknown = raw
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(list) && typeof list === 'object' && list !== null) {
    const o = list as Record<string, unknown>
    const nested = [
      o.items,
      o.projects,
      o.portfolio,
      o.work,
      o.videos,
      o.portfolio_items,
      o.portfolioItems,
      o.video_items,
      o.videoItems,
      o.entries,
      o.data,
    ]
    for (const n of nested) {
      if (Array.isArray(n)) {
        list = n
        break
      }
    }
  }
  if (!Array.isArray(list)) return []
  const out: PortfolioProject[] = []
  for (const p of list) {
    if (typeof p === 'string') {
      const s = p.trim()
      if (/^https?:\/\//i.test(s) || /^(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\b/i.test(s)) {
        const link = normalizeExternalVideoUrl(s.startsWith('http') ? s : `https://${s.replace(/^\/+/, '')}`)
        out.push({
          title: titleFromUrl(link),
          client: '',
          link,
        })
      }
      continue
    }
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    const roleRaw = r.role ?? r.category ?? r.type ?? r.role_in_project
    const link = extractProjectLink(r)
    const imgRaw =
      r.image_url ??
      r.thumbnail_url ??
      r.image ??
      r.cover_image ??
      r.thumb ??
      r.thumbnail ??
      r.poster ??
      r.preview_image ??
      r.previewImage
    const imageUrl =
      typeof imgRaw === 'string' && /^https?:\/\//i.test(imgRaw.trim()) ? imgRaw.trim() : undefined
    const titleRaw =
      String(r.title ?? r.name ?? r.slug ?? r.label ?? '').trim() ||
      String(r.client ?? r.company ?? r.brand ?? '').trim()
    const title = titleRaw || (link ? titleFromUrl(link) : 'Project')
    out.push({
      title,
      client: String(r.client ?? r.company ?? r.brand ?? ''),
      link,
      role: typeof roleRaw === 'string' && roleRaw.trim() ? roleRaw.trim() : undefined,
      image_url: imageUrl,
    })
  }
  return out
}
