/** Keep in sync with crea-services/lib/review-link-kind.ts */

export type ReviewLinkKind = 'frameio' | 'picdrop' | 'other'

function hostnameOf(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

function hostMatches(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`)
}

export function detectReviewLinkKind(raw: string | null | undefined): ReviewLinkKind {
  const url = raw?.trim()
  if (!url) return 'other'

  const host = hostnameOf(url)
  if (host) {
    if (hostMatches(host, 'picdrop.com') || hostMatches(host, 'picdrop.de')) return 'picdrop'
    if (hostMatches(host, 'frame.io') || hostMatches(host, 'f.io')) return 'frameio'
    return 'other'
  }

  const lowered = url.toLowerCase()
  if (lowered.includes('picdrop.')) return 'picdrop'
  if (lowered.includes('frame.io') || lowered.includes('frameio')) return 'frameio'
  return 'other'
}

export function reviewLinkLabel(kind: ReviewLinkKind): string {
  switch (kind) {
    case 'picdrop':
      return 'PicDrop'
    case 'frameio':
      return 'Frame.io'
    default:
      return 'Review'
  }
}

export function reviewLinkOpenLabel(kind: ReviewLinkKind): string {
  switch (kind) {
    case 'picdrop':
      return 'Open PicDrop'
    case 'frameio':
      return 'Open Frame.io'
    default:
      return 'Open review'
  }
}
