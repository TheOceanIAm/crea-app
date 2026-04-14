import { Linking } from 'react-native'

/** Base URL for the Crea web app (Brief AI, Frame.io deep links, etc.) */
export function getCreaWebBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_CREA_WEB_URL || '').replace(/\/$/, '')
}

export function openProjectOnWeb(projectId: string, path = ''): void {
  const base = getCreaWebBaseUrl()
  if (!base) {
    return
  }
  const suffix = path.startsWith('/') ? path : path ? `/${path}` : ''
  Linking.openURL(`${base}/projects/${projectId}${suffix}`).catch(() => {})
}
