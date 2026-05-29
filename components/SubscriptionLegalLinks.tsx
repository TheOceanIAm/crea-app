import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { openPrivacy, openTerms } from '@/lib/creaLegal'

type Props = {
  onRestore?: () => void
  restoring?: boolean
  variant?: 'light' | 'dark'
}

export function SubscriptionLegalLinks({ onRestore, restoring, variant = 'light' }: Props) {
  const linkStyle = variant === 'dark' ? styles.linkDark : styles.linkLight
  const dotStyle = variant === 'dark' ? styles.dotDark : styles.dotLight

  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={openPrivacy} hitSlop={8}>
        <Text style={linkStyle}>Privacy Policy</Text>
      </TouchableOpacity>
      <Text style={dotStyle}>·</Text>
      <TouchableOpacity onPress={openTerms} hitSlop={8}>
        <Text style={linkStyle}>Terms of Use (EULA)</Text>
      </TouchableOpacity>
      {onRestore ? (
        <>
          <Text style={dotStyle}>·</Text>
          <TouchableOpacity disabled={restoring} onPress={onRestore} hitSlop={8}>
            <Text style={linkStyle}>{restoring ? 'Restoring…' : 'Restore'}</Text>
          </TouchableOpacity>
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
  linkLight: {
    color: 'rgba(10,10,10,0.45)',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  linkDark: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  dotLight: { color: 'rgba(10,10,10,0.25)', fontSize: 12 },
  dotDark: { color: 'rgba(255,255,255,0.25)', fontSize: 12 },
})
