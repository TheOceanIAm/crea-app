import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native'
import { formatProductionWindowSummary } from '@/lib/projectProductionWindow'

type Props = {
  scheduleStart: string
  scheduleEnd: string
  onChangeStart: (v: string) => void
  onChangeEnd: (v: string) => void
  onSave: () => void | Promise<void>
  onClear: () => void | Promise<void>
  saving: boolean
  /** Starter freelancer plan — calendar blocking disabled */
  lockedByPlan: boolean
  /** Client company only — crew sees read-only summary */
  readOnly: boolean
}

export function ProjectOverviewProductionWindow({
  scheduleStart,
  scheduleEnd,
  onChangeStart,
  onChangeEnd,
  onSave,
  onClear,
  saving,
  lockedByPlan,
  readOnly,
}: Props) {
  const summary = formatProductionWindowSummary(scheduleStart, scheduleEnd)
  const canEdit = !readOnly && !lockedByPlan
  const hasBothSaved =
    /^\d{4}-\d{2}-\d{2}$/.test(scheduleStart.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(scheduleEnd.trim())

  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>Scheduling</Text>
      <Text style={styles.title}>Production window</Text>
      <Text style={styles.sub}>
        Overall production span for this listing (inclusive). When the project is active, this blocks the lead
        freelancer&apos;s public calendar. For different lengths per role, set dates per person in the Crew tab.
      </Text>
      {lockedByPlan ? (
        <Text style={styles.lockedHint}>Upgrade to Pro to sync busy dates to the freelancer&apos;s public profile.</Text>
      ) : null}
      {summary ? (
        <View style={styles.summaryPill}>
          <Text style={styles.summaryText}>{summary}</Text>
        </View>
      ) : (
        <Text style={styles.placeholder}>No dates set yet.</Text>
      )}
      {canEdit ? (
        <>
          <View style={styles.row}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Start</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={scheduleStart}
                onChangeText={onChangeStart}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>End</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={scheduleEnd}
                onChangeText={onChangeEnd}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.btnDim]}
              onPress={() => void onSave()}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save production window"
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save production window'}</Text>
            </TouchableOpacity>
            {hasBothSaved ? (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => void onClear()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Clear production dates"
              >
                <Text style={styles.clearBtnText}>Clear dates</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </>
      ) : readOnly ? (
        <Text style={styles.readOnlyHint}>Only the hiring company can edit these dates.</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 22,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.38)',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: { fontSize: 17, fontWeight: '800', color: '#fff', marginBottom: 8 },
  sub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.42)',
    lineHeight: 18,
    marginBottom: 12,
  },
  lockedHint: {
    fontSize: 12,
    color: '#FFDC00',
    marginBottom: 10,
    fontWeight: '700',
  },
  summaryPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 14,
  },
  summaryText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  placeholder: { fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 12 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  field: { flex: 1, minWidth: 0 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.8,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#fff',
  },
  actions: { gap: 10 },
  saveBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDim: { opacity: 0.55 },
  saveBtnText: { fontSize: 14, fontWeight: '800', color: '#0a0a0a' },
  clearBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 8 },
  clearBtnText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  readOnlyHint: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
})
