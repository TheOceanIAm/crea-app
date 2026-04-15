import { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { projectStatusDisplayLabel } from '@/lib/projectStatusDisplay'
import { isOnLocationWork, parseWorkLocation, workLocationTitle } from '@/lib/workLocationDisplay'

type Props = {
  title: string
  /** Job `location_type` copied onto the project (remote / on_site / hybrid). */
  location: string | null
  status: string
  /** Creative / project summary — same source as Brief AI “additional context”. */
  briefContext: string | null
}

export function ProjectOverviewAbout({ title, location, status, briefContext }: Props) {
  const workKind = parseWorkLocation(location)
  const workLabel = workLocationTitle(workKind)
  const onLoc = isOnLocationWork(workKind)

  const text = useMemo(() => {
    const brief = briefContext?.trim()
    if (brief) return brief
    const st = projectStatusDisplayLabel(status)
    return [
      title,
      `Status: ${st}`,
      onLoc
        ? 'On-location — add city, studio, or venue in the Brief AI tab so the crew knows where to go.'
        : 'Add a short project summary in the Brief AI tab — it appears here for the whole team.',
    ].join('\n')
  }, [briefContext, title, onLoc, status])

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>About this project</Text>

      <View style={styles.workStrip}>
        <Text style={styles.workStripLabel}>Work</Text>
        <Text style={styles.workStripMain}>{workLabel}</Text>
        {onLoc ? (
          <Text style={styles.workStripSub}>
            On-location shoot — add city, studio, or venue in Brief AI so everyone knows where to meet.
          </Text>
        ) : workKind === 'remote' ? (
          <Text style={styles.workStripSub}>This project is set up as remote.</Text>
        ) : null}
      </View>

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
  workStrip: {
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  workStripLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.38)',
    letterSpacing: 1.2,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  workStripMain: { fontSize: 17, fontWeight: '800', color: '#FFDC00' },
  workStripSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 8,
    lineHeight: 17,
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
