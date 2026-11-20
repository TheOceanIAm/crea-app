import { useEffect, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import { useIsFocused } from '@react-navigation/native'

import { useAppBootstrapOverlay } from '@/contexts/AppBootstrapOverlayContext'
import { logStartScreenViewed, startAccountType } from '@/lib/startScreenAnalytics'

const VISIBLE_MS = 600

/**
 * Once per app process, 600ms after the home screen has stayed on screen.
 * Tab changes do not send again. A new process does.
 * `role` null means the account type is not known yet.
 */
export function StartScreenBeacon({ role }: { role: string | null }) {
  const focused = useIsFocused()
  const { isBootstrapOverlayBlocking } = useAppBootstrapOverlay()
  const [appActive, setAppActive] = useState(AppState.currentState === 'active')
  const visibleSince = useRef<number | null>(null)

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active')
    })
    return () => sub.remove()
  }, [])

  const visible = focused && appActive && !isBootstrapOverlayBlocking

  useEffect(() => {
    if (Platform.OS !== 'ios' || !visible) {
      visibleSince.current = null
      return
    }
    if (visibleSince.current == null) visibleSince.current = Date.now()
    if (role == null) return
    const wait = Math.max(0, VISIBLE_MS - (Date.now() - visibleSince.current))
    const accountType = startAccountType(role)
    const timer = setTimeout(() => {
      logStartScreenViewed(accountType)
    }, wait)
    return () => clearTimeout(timer)
  }, [visible, role])

  return null
}
