/** Build external URLs for public profile social / portfolio fields. */

export function normalizeExternalUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('//')) return `https:${t}`
  return `https://${t.replace(/^\/+/, '')}`
}

export function instagramUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  const h = t.startsWith('@') ? t.slice(1) : t
  if (!h) return null
  return `https://instagram.com/${h.replace(/^@/, '')}`
}

export function linkedinUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  return `https://linkedin.com/in/${t.replace(/^\/+/, '')}`
}

export function vimeoUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  return `https://vimeo.com/${t.replace(/^\/+/, '')}`
}

export function behanceUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  return `https://behance.net/${t.replace(/^\/+/, '')}`
}
