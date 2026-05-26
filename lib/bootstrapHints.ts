import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'

const FAST_BOOTSTRAP_KEY = 'crea:fast_bootstrap_v1'
const HINTS_PREFIX = 'crea:bootstrap_hints:'

/** User has completed at least one successful app bootstrap — skip heavy splash animation. */
export async function readFastBootstrapEnabled(): Promise<boolean> {
  const v = await readPersistedCache<boolean>(FAST_BOOTSTRAP_KEY)
  return v === true
}

export async function markFastBootstrapEnabled(): Promise<void> {
  await writePersistedCache(FAST_BOOTSTRAP_KEY, true, 365 * 86_400_000)
}

export type BootstrapHints = {
  onboardingCompleted: boolean
  role: string | null
}

export function bootstrapHintsKey(userId: string): string {
  return `${HINTS_PREFIX}${userId}`
}

export async function readBootstrapHints(userId: string): Promise<BootstrapHints | null> {
  return readPersistedCache<BootstrapHints>(bootstrapHintsKey(userId))
}

export async function writeBootstrapHints(userId: string, hints: BootstrapHints): Promise<void> {
  await writePersistedCache(bootstrapHintsKey(userId), hints, 30 * 86_400_000)
}
