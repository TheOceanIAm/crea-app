import type { PropsWithChildren } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout'
import type { ResponsiveContentVariant } from '@/lib/responsiveLayout'

type Props = PropsWithChildren<{
  /** default = 720px tablet column; compact = 480px (auth/forms); wide = 960px */
  variant?: ResponsiveContentVariant
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
}>

/**
 * Centers tab/auth content on iPad with a max-width column.
 * Phone: full width. Tablet: readable column, full-bleed background on sides.
 */
export function ResponsiveScreen({ children, variant = 'default', style, contentStyle }: Props) {
  const { contentMaxWidth } = useResponsiveLayout(variant)

  return (
    <View style={[styles.shell, style]}>
      <View
        style={[
          styles.content,
          contentMaxWidth != null ? { maxWidth: contentMaxWidth } : null,
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    width: '100%',
  },
})
