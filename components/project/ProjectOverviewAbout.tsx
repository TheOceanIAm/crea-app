import { View, Text, StyleSheet } from 'react-native'

type Props = {
  /** Project summary entered when creating/editing the workspace project. */
  briefContext: string | null
}

export function ProjectOverviewAbout({ briefContext }: Props) {
  const text = briefContext?.trim() || 'No project summary yet. Add it in the Overview edit section below.'

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>About this project</Text>
      <View style={styles.card}>
        <Text style={styles.body} selectable>
          {text}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 20 },
  label: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.5,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  body: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.82)',
    lineHeight: 21,
  },
})
