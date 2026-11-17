import { Platform } from 'react-native'

import { fetchCreaApi } from '@/lib/creaApiFetch'

export type StartAccountType = 'freelancer' | 'company' | 'ceo'

let loggedThisProcess = false

export function startAccountType(role: string | null | undefined): StartAccountType {
  const value = (role ?? '').trim().toLowerCase()
  if (value === 'company' || value === 'ceo') return value
  return 'freelancer'
}

/** Once per app process, when the projects dashboard is the screen they actually land on. */
export function logStartScreenViewed(accountType: StartAccountType): void {
  if (loggedThisProcess) return
  loggedThisProcess = true
  const platform = Platform.OS === 'web' ? 'web' : 'ios'
  void fetchCreaApi('/api/analytics/page-view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'start_screen_viewed',
      path: '/dashboard',
      platform,
      accountType,
    }),
  }).catch(() => {})
}
