import { StyleSheet, Text, View } from 'react-native'
import { formatOfflinePackStamp } from '@/lib/offlinePack'

export function OfflinePackBanner({
  downloadedAt,
  pendingStatuses = 0,
}: {
  downloadedAt?: string | null
  pendingStatuses?: number
}) {
  const stamp = downloadedAt ? formatOfflinePackStamp(downloadedAt) : null
  const pending =
    pendingStatuses > 0
      ? ` ${pendingStatuses} shot status${pendingStatuses === 1 ? '' : 'es'} will sync when you are back online.`
      : ''
  return (
    <View style={styles.banner}>
      <Text style={styles.title}>Offline copy</Text>
      <Text style={styles.body}>
        {stamp ? `Downloaded ${stamp}. ` : ''}
        Shot status can still be cycled on set. Other edits need a connection.{pending}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    marginBottom: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.28)',
    backgroundColor: 'rgba(255,220,0,0.08)',
  },
  title: { color: '#FFDC00', fontSize: 12, fontWeight: '800', marginBottom: 4, letterSpacing: 0.4 },
  body: { color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 17 },
})
