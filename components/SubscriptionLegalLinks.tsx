import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { openPrivacy, openTerms } from '@/lib/creaLegal'

type Props = {
  onRestore?: () => void
  restoring?: boolean
  variant?: 'light' | 'dark'
  /** Stack links vertically for reliable touch targets on the paywall. */
  layout?: 'inline' | 'stack'
}

export function SubscriptionLegalLinks({
  onRestore,
  restoring,
  variant = 'light',
  layout = 'inline',
}: Props) {
  const linkStyle = variant === 'dark' ? styles.linkDark : styles.linkLight
  const dotStyle = variant === 'dark' ? styles.dotDark : styles.dotLight

  const privacyLink = (
    <TouchableOpacity
      onPress={openPrivacy}
      hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
      style={layout === 'stack' ? styles.stackItem : undefined}
      accessibilityRole="link"
    >
      <Text style={linkStyle}>Privacy Policy</Text>
    </TouchableOpacity>
  )

  const termsLink = (
    <TouchableOpacity
      onPress={openTerms}
      hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
      style={layout === 'stack' ? styles.stackItem : undefined}
      accessibilityRole="link"
    >
      <Text style={linkStyle}>Terms of Use (EULA)</Text>
    </TouchableOpacity>
  )

  const restoreLink = onRestore ? (
    <TouchableOpacity
      disabled={restoring}
      onPress={onRestore}
      hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
      style={layout === 'stack' ? styles.stackItem : undefined}
      accessibilityRole="button"
    >
      <Text style={linkStyle}>{restoring ? 'Restoring…' : 'Restore purchases'}</Text>
    </TouchableOpacity>
  ) : null

  if (layout === 'stack') {
    return (
      <View style={styles.stack}>
        {privacyLink}
        {termsLink}
        {restoreLink}
      </View>
    )
  }

  return (
    <View style={styles.row}>
      {privacyLink}
      <Text style={dotStyle}>·</Text>
      {termsLink}
      {restoreLink ? (
        <>
          <Text style={dotStyle}>·</Text>
          {restoreLink}
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  stack: {
    alignItems: 'center',
    gap: 2,
  },
  stackItem: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  linkLight: {
    color: 'rgba(10,10,10,0.55)',
    fontSize: 13,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  linkDark: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  dotLight: { color: 'rgba(10,10,10,0.25)', fontSize: 12 },
  dotDark: { color: 'rgba(255,255,255,0.25)', fontSize: 12 },
})
