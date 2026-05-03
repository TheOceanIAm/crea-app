import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, Pressable } from 'react-native'

type Props = {
  visible: boolean
  body: string
  source?: string
  onDismiss: () => void
}

export function GoodNewsDailyModal({ visible, body, source, onDismiss }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
        <View style={styles.cardWrap} pointerEvents="box-none">
          <View style={styles.card}>
            <Text style={styles.kicker}>GOOD NEWS OF THE DAY</Text>
            <Text style={styles.body}>{body}</Text>
            {source ? <Text style={styles.source}>{source}</Text> : null}
            <TouchableOpacity style={styles.btn} onPress={onDismiss} activeOpacity={0.85}>
              <Text style={styles.btnText}>Nice</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  cardWrap: {
    zIndex: 1,
    ...Platform.select({
      web: { maxWidth: 420, width: '100%', alignSelf: 'center' },
      default: {},
    }),
  },
  card: {
    backgroundColor: '#161616',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    padding: 22,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#4ade80',
    marginBottom: 12,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#f5f5f5',
    marginBottom: 14,
  },
  source: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.38)',
    marginBottom: 18,
  },
  btn: {
    alignSelf: 'flex-end',
    backgroundColor: '#FFDC00',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 999,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0a0a0a',
  },
})
