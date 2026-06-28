import { AppState, Platform } from 'react-native'
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query'

/**
 * Single shared QueryClient instance.
 *
 * Exported as a module singleton (not created inside a component) so non-React
 * code — e.g. `invalidateDmBadge()` — can call `queryClient.invalidateQueries(...)`
 * directly. The same instance is handed to <QueryClientProvider> in app/_layout.tsx.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Treat data as fresh for 30s; within that window cache is served instantly
      // and no refetch fires. This mirrors the old per-loader STALE_MS behaviour.
      staleTime: 30_000,
      // Keep unused cache around for 5 min before garbage collection.
      gcTime: 5 * 60_000,
      retry: 1,
      // We drive refetch-on-focus through AppState below (RN has no window focus).
      refetchOnWindowFocus: true,
    },
  },
})

// React Native focus integration: refetch stale queries when the app returns to
// the foreground. Replaces hand-rolled AppState listeners in individual hooks.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (state) => {
      handleFocus(state === 'active')
    })
    return () => sub.remove()
  })

  // Online detection is best-effort on native; assume online so queries are not
  // paused. (Supabase fetch retry already handles transient connectivity.)
  onlineManager.setOnline(true)
}
