import AsyncStorage from '@react-native-async-storage/async-storage'

type PersistedEntry<T> = {
  value: T
  expiresAt: number
}

export async function readPersistedCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedEntry<T>
    if (!parsed || typeof parsed.expiresAt !== 'number') return null
    if (Date.now() > parsed.expiresAt) {
      await AsyncStorage.removeItem(key).catch(() => {})
      return null
    }
    return parsed.value
  } catch {
    return null
  }
}

export async function writePersistedCache<T>(key: string, value: T, ttlMs: number): Promise<void> {
  try {
    const entry: PersistedEntry<T> = {
      value,
      expiresAt: Date.now() + Math.max(1, ttlMs),
    }
    await AsyncStorage.setItem(key, JSON.stringify(entry))
  } catch {
    /* non-blocking */
  }
}

export async function deletePersistedCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
