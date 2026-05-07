type Entry<T> = {
  value: T
  expiresAt: number
}

const store = new Map<string, Entry<unknown>>()

export function getCache<T>(key: string): T | null {
  const hit = store.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    store.delete(key)
    return null
  }
  return hit.value as T
}

export function setCache<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) })
}

export function clearCacheByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

export function deleteCache(key: string): void {
  store.delete(key)
}
