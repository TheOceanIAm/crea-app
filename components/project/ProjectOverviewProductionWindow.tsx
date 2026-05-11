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
      <Text style={styles.title}>Production window</Text>
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
              accessibilityLabel="Save production dates"
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
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
    marginBottom: 18,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  lockedHint: {
    fontSize: 11,
    color: '#FFDC00',
    marginBottom: 8,
    fontWeight: '700',
    lineHeight: 15,
  },
  summaryPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 10,
  },
  summaryText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  placeholder: { fontSize: 12, color: 'rgba(255,255,255,0.32)', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  field: { flex: 1, minWidth: 0 },
  fieldLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.32)',
    letterSpacing: 0.8,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
    color: '#fff',
  },
  actions: { gap: 8 },
  saveBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnDim: { opacity: 0.55 },
  saveBtnText: { fontSize: 13, fontWeight: '800', color: '#0a0a0a' },
  clearBtn: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  clearBtnText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  readOnlyHint: { fontSize: 11, color: 'rgba(255,255,255,0.32)', marginTop: 2 },
})
