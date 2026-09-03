/**
 * Shared cache TTLs so list screens keep a warm mem hit between
 * login hydrate and the user opening a tab.
 */
export const LIST_MEM_TTL_MS = 15 * 60_000
export const LIST_STALE_MS = 45_000
export const LIST_DISK_TTL_MS = 24 * 60 * 60 * 1000
