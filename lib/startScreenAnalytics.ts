export type StartAccountType = 'freelancer' | 'company' | 'ceo'

const ENDPOINT = 'https://www.creaservices.de/api/analytics/page-view'

/** Product UA. Must not match the server bot filter, or the row is dropped. */
const USER_AGENT = 'CREA/1.0 (iOS; de.creaservices.app)'

const START_SCREEN_PATH: Record<StartAccountType, string> = {
  freelancer: '/freelancer-dashboard',
  company: '/company-dashboard',
  ceo: '/ceo-dashboard',
}

let loggedThisProcess = false

export function startAccountType(role: string | null | undefined): StartAccountType {
  const value = (role ?? '').trim().toLowerCase()
  if (value === 'company' || value === 'ceo') return value
  return 'freelancer'
}

export function startScreenPath(accountType: StartAccountType): string {
  return START_SCREEN_PATH[accountType]
}

/**
 * Once per app process. Caller waits until the home screen has stayed visible.
 * No auth header and no user id, email, or name. Failures stay silent.
 */
export function logStartScreenViewed(accountType: StartAccountType): void {
  if (loggedThisProcess) return
  loggedThisProcess = true
  const path = startScreenPath(accountType)
  void fetch(ENDPOINT, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      event: 'start_screen_viewed',
      path,
      platform: 'ios',
      accountType,
    }),
  }).catch(() => {})
}
