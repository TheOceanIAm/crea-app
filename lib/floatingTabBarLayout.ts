import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/** Visual height of the floating pill (icons only, Instagram-style). */
export const FLOATING_TAB_BAR_PILL_HEIGHT = 54

/** Gap between pill bottom and home indicator. */
export const FLOATING_TAB_BAR_BOTTOM_GAP = 10

/** Horizontal inset from screen edges. */
export const FLOATING_TAB_BAR_HORIZONTAL_INSET = 16

/** Total vertical space screens should reserve above the home indicator. */
export function floatingTabBarBottomInset(safeBottom: number): number {
  return safeBottom + FLOATING_TAB_BAR_BOTTOM_GAP + FLOATING_TAB_BAR_PILL_HEIGHT
}

export function useFloatingTabBarBottomInset(): number {
  const insets = useSafeAreaInsets()
  return floatingTabBarBottomInset(insets.bottom)
}

/** Height passed to React Navigation tabBarStyle (absolute tab bar slot). */
export function floatingTabBarSlotHeight(safeBottom: number): number {
  return floatingTabBarBottomInset(safeBottom) + 8
}

/**
 * Hide the floating tab bar on nested detail stacks (jobs/[id], invoices/[id], …).
 * Pathname from expo-router (groups like `(tabs)` are stripped).
 */
export function shouldHideFloatingTabBar(pathname: string): boolean {
  const path = (pathname.split('?')[0] ?? pathname).replace(/\/+$/, '') || '/'
  if (/^\/jobs\/[^/]+$/.test(path)) return true
  if (/^\/invoices\/[^/]+$/.test(path)) return true
  return false
}

/** True when the focused tab’s stack is on a non-index screen (e.g. `[id]`). */
export function focusedTabHasNestedDetail(state: BottomTabBarProps['state']): boolean {
  const tab = state.routes[state.index]
  const nested = tab?.state
  if (!nested || typeof nested.index !== 'number' || !Array.isArray(nested.routes)) {
    return false
  }
  const focused = nested.routes[nested.index]
  if (!focused?.name) return false
  return focused.name !== 'index'
}
