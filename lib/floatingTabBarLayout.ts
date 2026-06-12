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
