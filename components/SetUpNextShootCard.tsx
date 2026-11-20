import { Text, TouchableOpacity, StyleSheet, View } from 'react-native'

/** Empty dashboard when the account does not own a project yet. Same card as the web home. */
export function SetUpNextShootCard({
  canCreate,
  onCreate,
  onSecondary,
  secondaryLabel,
  lockedHint = 'Upgrade to Pro or Workspace to create a private project. You can still open work a company books you on.',
}: {
  canCreate: boolean
  onCreate: () => void
  onSecondary: () => void
  secondaryLabel: string
  lockedHint?: string
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Set up your next shoot</Text>
      <Text style={styles.body}>
        Brief, crew, call sheet, and budget in one place. Invite people when you are ready.
      </Text>
      {canCreate ? (
        <TouchableOpacity style={styles.button} onPress={onCreate} accessibilityRole="button">
          <Text style={styles.buttonText}>Set up your next shoot</Text>
        </TouchableOpacity>
      ) : (
        <Text style={styles.hint}>{lockedHint}</Text>
      )}
      <TouchableOpacity onPress={onSecondary} accessibilityRole="link">
        <Text style={styles.demo}>{secondaryLabel}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 20,
    paddingVertical: 28,
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  body: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14 },
  hint: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 8,
  },
  demo: { color: '#FFDC00', fontSize: 14, fontWeight: '600', marginTop: 12 },
})
