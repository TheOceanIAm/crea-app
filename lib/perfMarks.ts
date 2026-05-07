type TimedResult<T> = { value: T; ms: number }

/**
 * Dev-only timing helper for async hot paths.
 * No-op overhead in production builds.
 */
export async function runTimed<T>(label: string, fn: () => Promise<T>): Promise<TimedResult<T>> {
  const start = Date.now()
  const value = await fn()
  const ms = Date.now() - start
  if (__DEV__) {
    // Keep logs compact so they are readable on device terminals.
    console.log(`[perf] ${label}: ${ms}ms`)
  }
  return { value, ms }
}
