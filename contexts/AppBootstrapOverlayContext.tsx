import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { AppBootstrapLoading } from '@/components/AppBootstrapLoading'

const FAILSAFE_MS = 8_000

type ShowBootstrapOptions = {
  quick?: boolean
}

type AppBootstrapOverlayContextValue = {
  quickBootstrap: boolean
  showBootstrapOverlay: (opts?: ShowBootstrapOptions) => void
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
  const [visible, setVisible] = useState(false)
  const [quickBootstrap, setQuickBootstrap] = useState(true)
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hideBootstrapOverlay = useCallback(() => {
    if (failsafeRef.current) {
      clearTimeout(failsafeRef.current)
      failsafeRef.current = null
    }
    setVisible(false)
  }, [])

  const showBootstrapOverlay = useCallback(
    (opts?: ShowBootstrapOptions) => {
      setQuickBootstrap(opts?.quick !== false)
      setVisible(true)
      if (failsafeRef.current) clearTimeout(failsafeRef.current)
      failsafeRef.current = setTimeout(() => {
        failsafeRef.current = null
        setVisible(false)
      }, FAILSAFE_MS)
    },
    []
  )

  const ctx = useMemo(
    () => ({
      quickBootstrap,
      showBootstrapOverlay,
      hideBootstrapOverlay,
    }),
    [quickBootstrap, showBootstrapOverlay, hideBootstrapOverlay]
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
          <AppBootstrapLoading quick={quickBootstrap} />
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
