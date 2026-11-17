import type { Href } from 'expo-router'

type BackRouter = {
  navigate: (href: Href) => void
  back: () => void
  canGoBack: () => boolean
}

/** Route to reopen when a screen was opened from somewhere else, such as the dashboard. */
let returnHref: Href | null = null

export function setScreenReturn(href: Href) {
  returnHref = href
}

export function peekScreenReturn(): Href | null {
  return returnHref
}

export function takeScreenReturn(): Href | null {
  const href = returnHref
  returnHref = null
  return href
}

export function clearScreenReturn() {
  returnHref = null
}

function isFeedHref(href: Href): boolean {
  const path = typeof href === 'string' ? href : href.pathname
  return path === '/feed' || path === '/(tabs)/feed'
}

/** Open the screen that launched this one, usually the dashboard. Never the hidden feed. */
export function returnToPreviousScreen(router: BackRouter, fallback: Href = '/(tabs)/dashboard') {
  const target = takeScreenReturn()
  if (target && !isFeedHref(target)) {
    router.navigate(target)
    return
  }
  router.navigate(fallback)
}
