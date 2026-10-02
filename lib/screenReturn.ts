import type { Href } from 'expo-router'

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
