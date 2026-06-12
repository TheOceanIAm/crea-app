import type { ReactNode } from 'react'
import { Platform, ScrollView, type ScrollViewProps, StyleSheet } from 'react-native'
import { useFloatingTabBarBottomInset } from '@/lib/floatingTabBarLayout'

type Props = ScrollViewProps & {
  children: ReactNode
  /** Extra space below content (action buttons, etc.). Default 48. */
  extraBottomPadding?: number
  /** Reserve space for the floating tab bar. Default true on tab screens. */
  includeTabBarInset?: boolean
}

/**
 * Scrollable form surface that stays usable with the keyboard open:
 * iOS adjusts insets automatically; extra bottom padding clears the tab bar + action buttons.
 */
export function KeyboardAwareScrollView({
  children,
  contentContainerStyle,
  extraBottomPadding = 48,
  includeTabBarInset = true,
  keyboardShouldPersistTaps = 'handled',
  keyboardDismissMode,
  showsVerticalScrollIndicator = false,
  style,
  ...rest
}: Props) {
  const tabBarInset = useFloatingTabBarBottomInset()
  const bottomPad = (includeTabBarInset ? tabBarInset : 0) + extraBottomPadding

  return (
    <ScrollView
      {...rest}
      style={[styles.scroll, style]}
      contentContainerStyle={[contentContainerStyle, { paddingBottom: bottomPad }]}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={
        keyboardDismissMode ?? (Platform.OS === 'ios' ? 'interactive' : 'on-drag')
      }
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
    >
      {children}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
})
