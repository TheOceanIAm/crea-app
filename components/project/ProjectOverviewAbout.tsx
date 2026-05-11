import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native'
import { Pencil } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'

type Props = {
  /** Project summary (workspace summary); driven by parent state when editing. */
  briefContext: string | null
  /** Company / owner: show pencil and optional edit UI. */
  canEdit?: boolean
  onChangeBrief?: (text: string) => void
  onSaveBrief?: () => Promise<boolean>
  saving?: boolean
}

export function ProjectOverviewAbout({
  briefContext,
  canEdit,
  onChangeBrief,
  onSaveBrief,
  saving,
}: Props) {
  const [editing, setEditing] = useState(false)
  const displayLine =
    (briefContext ?? '').trim() || 'No project summary yet.'
  const showEditChrome = Boolean(canEdit && onChangeBrief && onSaveBrief)

  const toggleEdit = () => setEditing((v) => !v)

  const handleSave = async () => {
    if (!onSaveBrief) return
    const ok = await onSaveBrief()
    if (ok) setEditing(false)
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>About this project</Text>
        {showEditChrome ? (
          <TouchableOpacity
            onPress={toggleEdit}
            style={styles.pencilBtn}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Close editing' : 'Edit project summary'}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Pencil size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.card}>
        {showEditChrome && editing ? (
          <>
            <TextInput
              style={styles.input}
              multiline
              placeholder="Project summary for your crew…"
              placeholderTextColor="rgba(255,255,255,0.25)"
              value={briefContext ?? ''}
              onChangeText={onChangeBrief}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDim]}
              onPress={() => void handleSave()}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#0a0a0a" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Save summary</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.body} selectable>
            {displayLine}
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 20 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  pencilBtn: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
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
  input: {
    minHeight: 140,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 14,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  saveBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FFDC00',
    minWidth: 120,
    alignItems: 'center',
  },
  saveBtnDim: { opacity: 0.55 },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: '#0a0a0a' },
})
