import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { AppBootstrapLoading } from '@/components/AppBootstrapLoading'

const FAILSAFE_MS = 45_000

type AppBootstrapOverlayContextValue = {
  /** Turns the full-screen overlay on and (re-)arms the stuck-state failsafe timer. */
  showBootstrapOverlay: () => void
  /** Hides the overlay and clears the failsafe timer. */
  hideBootstrapOverlay: () => void
}

const AppBootstrapOverlayContext = createContext<AppBootstrapOverlayContextValue | null>(null)

export function useAppBootstrapOverlay() {
  const ctx = useContext(AppBootstrapOverlayContext)
  if (!ctx) {
    throw new Error('useAppBootstrapOverlay must be used within AppBootstrapOverlayProvider')
  }
  return ctx
}

export function AppBootstrapOverlayProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(true)
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const armFailsafe = useCallback(() => {
    if (failsafeRef.current) clearTimeout(failsafeRef.current)
    failsafeRef.current = setTimeout(() => {
      failsafeRef.current = null
      setVisible(false)
    }, FAILSAFE_MS)
  }, [])

  const hideBootstrapOverlay = useCallback(() => {
    if (failsafeRef.current) {
      clearTimeout(failsafeRef.current)
      failsafeRef.current = null
    }
    setVisible(false)
  }, [])

  const showBootstrapOverlay = useCallback(() => {
    setVisible(true)
    armFailsafe()
  }, [armFailsafe])

  useEffect(() => {
    armFailsafe()
    return () => {
      if (failsafeRef.current) clearTimeout(failsafeRef.current)
    }
  }, [armFailsafe])

  const ctx = useMemo(
    () => ({ showBootstrapOverlay, hideBootstrapOverlay }),
    [showBootstrapOverlay, hideBootstrapOverlay]
  )

  return (
    <AppBootstrapOverlayContext.Provider value={ctx}>
      {children}
      {visible ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="auto"
          style={styles.overlayWrap}
        >
          <AppBootstrapLoading />
        </View>
      ) : null}
    </AppBootstrapOverlayContext.Provider>
  )
}

const styles = StyleSheet.create({
  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
    zIndex: 99999,
    elevation: 99999,
  },
})
