/**
 * In-profile YouTube / Vimeo player URLs.
 * Keep in sync with crea-services `lib/freelancer-portfolio.ts` (`portfolioVideoEmbed`).
 */

export type PortfolioVideoEmbed = {
  provider: 'youtube' | 'vimeo'
  embedUrl: string
  watchUrl: string
  label: 'YouTube' | 'Vimeo'
}

function withProtocol(raw: string): string {
  const t = raw.trim()
  if (/^https?:\/\//i.test(t)) return t
  if (t.startsWith('//')) return `https:${t}`
  return `https://${t}`
}

function parseHttpUrl(raw: string): URL | null {
  try {
    return new URL(withProtocol(raw))
  } catch {
    return null
  }
}

function isYoutubeHost(host: string): boolean {
  return (
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host.endsWith('.youtube.com')
  )
}

function youtubeVideoId(page: URL): string | null {
  if (!isYoutubeHost(page.hostname.replace(/^www\./i, '').toLowerCase())) return null
  const path = page.pathname
  const fromPath = path.match(/\/(?:embed|shorts|live|v)\/([\w-]{6,})/i)
  if (fromPath) return fromPath[1]
  if (page.hostname.replace(/^www\./i, '').toLowerCase() === 'youtu.be') {
    const id = path.split('/').filter(Boolean)[0]
    if (id && /^[\w-]{6,}$/.test(id)) return id
  }
  const watch = page.searchParams.get('v')
  if (watch && /^[\w-]{6,}$/.test(watch)) return watch
  return null
}

function vimeoParts(page: URL): { id: string; hash?: string } | null {
  const parts = page.pathname.split('/').filter(Boolean)
  if (parts.includes('showcase') && !parts.includes('video')) return null

  let id: string | undefined
  let hashFromPath: string | undefined
  const videoIdx = parts.findIndex((p) => p === 'video' || p === 'videos')
  if (videoIdx >= 0 && /^\d+$/.test(parts[videoIdx + 1] ?? '')) {
    id = parts[videoIdx + 1]
    const next = parts[videoIdx + 2]
    if (next && /^[A-Za-z0-9]+$/.test(next)) hashFromPath = next
  } else {
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d{6,}$/.test(parts[i] ?? '')) {
        id = parts[i]
        const next = parts[i + 1]
        if (next && /^[A-Za-z0-9]+$/.test(next)) hashFromPath = next
        break
      }
    }
  }
  if (!id) return null
  const hParam = page.searchParams.get('h')?.trim()
  const hash = hParam && /^[A-Za-z0-9]+$/.test(hParam) ? hParam : hashFromPath
  return hash ? { id, hash } : { id }
}

export function portfolioVideoEmbed(raw: string | null | undefined): PortfolioVideoEmbed | null {
  if (!raw?.trim()) return null
  const page = parseHttpUrl(raw)
  if (!page) return null
  const host = page.hostname.replace(/^www\./i, '').toLowerCase()

  if (isYoutubeHost(host)) {
    const id = youtubeVideoId(page)
    if (!id) return null
    const params = new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1' })
    return {
      provider: 'youtube',
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`,
      watchUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
      label: 'YouTube',
    }
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const parts = vimeoParts(page)
    if (!parts) return null
    const q = new URLSearchParams()
    if (parts.hash) q.set('h', parts.hash)
    const qs = q.toString()
    return {
      provider: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${parts.id}${qs ? `?${qs}` : ''}`,
      watchUrl: page.href,
      label: 'Vimeo',
    }
  }

  return null
}
