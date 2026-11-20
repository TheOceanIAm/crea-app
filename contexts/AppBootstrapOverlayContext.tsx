import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { FullWindowOverlay } from 'react-native-screens'
import { AppBootstrapLoading } from '@/components/AppBootstrapLoading'

const FAILSAFE_MS = 8_000
/** Hold long enough for the mark to land before the reveal, even if session resolves instantly. */
const MIN_PLAY_MS = 1_150
const MIN_PLAY_QUICK_MS = 880
const EXIT_FAILSAFE_MS = 3_200

type ShowBootstrapOptions = {
  quick?: boolean
}

type HideBootstrapOptions = {
  /** Skip the minimum play time. The exit animation still runs. */
  immediate?: boolean
  /** Fires once the yellow field covers the screen, before the overlay is removed. */
  onReveal?: () => void
}

type AppBootstrapOverlayContextValue = {
  quickBootstrap: boolean
  /** True while splash is visible or fading out — block modals (e.g. Good News) until clear. */
  isBootstrapOverlayBlocking: boolean
  showBootstrapOverlay: (opts?: ShowBootstrapOptions) => void
  hideBootstrapOverlay: (opts?: HideBootstrapOptions) => void
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
  const [exiting, setExiting] = useState(false)
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exitDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hidingRef = useRef(false)
  const hidePendingRef = useRef(false)
  const visibleRef = useRef(false)
  const shownAtRef = useRef(0)
  const quickRef = useRef(true)
  const revealRef = useRef<(() => void) | null>(null)

  const releaseReveal = useCallback(() => {
    const reveal = revealRef.current
    revealRef.current = null
    reveal?.()
  }, [])

  const clearFailsafe = useCallback(() => {
    if (failsafeRef.current) {
      clearTimeout(failsafeRef.current)
      failsafeRef.current = null
    }
  }, [])

  const finishHide = useCallback(() => {
    clearFailsafe()
    if (exitDelayRef.current) {
      clearTimeout(exitDelayRef.current)
      exitDelayRef.current = null
    }
    hidingRef.current = false
    hidePendingRef.current = false
    visibleRef.current = false
    releaseReveal()
    setExiting(false)
    setVisible(false)
    setIsBootstrapOverlayBlocking(false)
  }, [clearFailsafe, releaseReveal])

  const beginExit = useCallback(() => {
    exitDelayRef.current = null
    if (!visibleRef.current) {
      finishHide()
      return
    }
    hidingRef.current = true
    setExiting(true)
    clearFailsafe()
    failsafeRef.current = setTimeout(finishHide, EXIT_FAILSAFE_MS)
  }, [clearFailsafe, finishHide])

  const hideBootstrapOverlay = useCallback(
    (opts?: HideBootstrapOptions) => {
      clearFailsafe()
      if (opts?.onReveal) revealRef.current = opts.onReveal
      if (hidingRef.current || hidePendingRef.current) return
      hidePendingRef.current = true
      const minPlay = quickRef.current ? MIN_PLAY_QUICK_MS : MIN_PLAY_MS
      const wait = opts?.immediate ? 0 : Math.max(0, minPlay - (Date.now() - shownAtRef.current))
      exitDelayRef.current = setTimeout(beginExit, wait)
    },
    [beginExit, clearFailsafe]
  )

  const showBootstrapOverlay = useCallback(
    (opts?: ShowBootstrapOptions) => {
      if (hidingRef.current || hidePendingRef.current) return
      if (exitDelayRef.current) {
        clearTimeout(exitDelayRef.current)
        exitDelayRef.current = null
      }
      hidingRef.current = false
      hidePendingRef.current = false
      revealRef.current = null
      const quick = opts?.quick !== false
      quickRef.current = quick
      setQuickBootstrap(quick)
      setExiting(false)
      setIsBootstrapOverlayBlocking(true)
      if (!visibleRef.current) shownAtRef.current = Date.now()
      visibleRef.current = true
      setVisible(true)
      clearFailsafe()
      failsafeRef.current = setTimeout(finishHide, FAILSAFE_MS)
    },
    [clearFailsafe, finishHide]
  )

  useEffect(() => {
    return () => {
      if (failsafeRef.current) clearTimeout(failsafeRef.current)
      if (exitDelayRef.current) clearTimeout(exitDelayRef.current)
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
        <SplashWindow>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="auto"
            style={styles.overlayWrap}
          >
            <AppBootstrapLoading
              quick={quickBootstrap}
              exiting={exiting}
              onCovered={releaseReveal}
              onExitEnd={finishHide}
            />
          </View>
        </SplashWindow>
      ) : null}
    </AppBootstrapOverlayContext.Provider>
  )
}

function SplashWindow({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'ios') return <FullWindowOverlay>{children}</FullWindowOverlay>
  return children
}

const styles = StyleSheet.create({
  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0a0a',
    zIndex: 99999,
    elevation: 99999,
  },
})
