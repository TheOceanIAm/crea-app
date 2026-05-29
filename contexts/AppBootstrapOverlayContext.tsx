import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { AppBootstrapLoading } from '@/components/AppBootstrapLoading'

const FAILSAFE_MS = 8_000
const FADE_OUT_MS = 280

type ShowBootstrapOptions = {
  quick?: boolean
}

type AppBootstrapOverlayContextValue = {
  quickBootstrap: boolean
  /** True while splash is visible or fading out — block modals (e.g. Good News) until clear. */
  isBootstrapOverlayBlocking: boolean
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
  const [isBootstrapOverlayBlocking, setIsBootstrapOverlayBlocking] = useState(false)
  const [quickBootstrap, setQuickBootstrap] = useState(true)
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeRef = useRef(new Animated.Value(1)).current
  const hidingRef = useRef(false)

  const clearBlocking = useCallback(() => {
    setIsBootstrapOverlayBlocking(false)
  }, [])

  const hideBootstrapOverlay = useCallback(() => {
    if (failsafeRef.current) {
      clearTimeout(failsafeRef.current)
      failsafeRef.current = null
    }
    if (hidingRef.current) return
    hidingRef.current = true
    Animated.timing(fadeRef, {
      toValue: 0,
      duration: FADE_OUT_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      hidingRef.current = false
      if (finished) {
        setVisible(false)
        fadeRef.setValue(1)
        clearBlocking()
      }
    })
  }, [fadeRef, clearBlocking])

  const showBootstrapOverlay = useCallback(
    (opts?: ShowBootstrapOptions) => {
      hidingRef.current = false
      fadeRef.setValue(1)
      setQuickBootstrap(opts?.quick !== false)
      setIsBootstrapOverlayBlocking(true)
      setVisible(true)
      if (failsafeRef.current) clearTimeout(failsafeRef.current)
      failsafeRef.current = setTimeout(() => {
        failsafeRef.current = null
        setVisible(false)
        fadeRef.setValue(1)
        clearBlocking()
      }, FAILSAFE_MS)
    },
    [fadeRef, clearBlocking]
  )

  useEffect(() => {
    return () => {
      if (failsafeRef.current) clearTimeout(failsafeRef.current)
    }
  }, [])

  const ctx = useMemo(
    () => ({
      quickBootstrap,
      isBootstrapOverlayBlocking,
      showBootstrapOverlay,
      hideBootstrapOverlay,
    }),
    [quickBootstrap, isBootstrapOverlayBlocking, showBootstrapOverlay, hideBootstrapOverlay]
  )

  return (
    <AppBootstrapOverlayContext.Provider value={ctx}>
      {children}
      {visible ? (
        <Animated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="auto"
          style={[styles.overlayWrap, { opacity: fadeRef }]}
        >
          <AppBootstrapLoading quick={quickBootstrap} />
        </Animated.View>
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
