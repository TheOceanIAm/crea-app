import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Check, Plus, Trash2, CalendarClock } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { ICON_STROKE } from '@/lib/iconTheme'
import { formatMilestoneSchedule, isoFromDateAndTime } from '@/lib/milestoneSchedule'

type Milestone = {
  id: string
  project_id: string
  title: string
  sort_order: number
  completed: boolean
  scheduled_at: string | null
}

type Props = {
  projectId: string
  onCountsChanged?: () => void
  /** Company or lead: add/remove milestones. Crew can still mark items complete when false. */
  canManage: boolean
}

function defaultScheduleDate(): Date {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

export function ProjectMilestonesTab({ projectId, onCountsChanged, canManage }: Props) {
  const [rows, setRows] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleDate, setScheduleDate] = useState(() => defaultScheduleDate())
  const [scheduleTime, setScheduleTime] = useState(() => defaultScheduleDate())
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_milestones')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })

    if (error) {
      Alert.alert('Milestones', error.message)
      setRows([])
    } else {
      setRows((data as Milestone[]) ?? [])
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (event.type === 'dismissed') {
      setPickerMode(null)
      return
    }
    if (!value) return
    if (pickerMode === 'date') setScheduleDate(value)
    if (pickerMode === 'time') setScheduleTime(value)
    if (Platform.OS === 'android') setPickerMode(null)
  }

  const scheduledIso = scheduleEnabled ? isoFromDateAndTime(scheduleDate, scheduleTime) : null

  const add = async () => {
    const t = newTitle.trim()
    if (!t || busy) return
    setBusy(true)
    const nextOrder = rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('project_milestones')
      .insert({
        project_id: projectId,
        title: t,
        sort_order: nextOrder,
        scheduled_at: scheduledIso,
      })
      .select('*')
      .single()
    setBusy(false)
    if (error) {
      Alert.alert('Could not add', error.message)
      return
    }
    setNewTitle('')
    setScheduleEnabled(false)
    setScheduleDate(defaultScheduleDate())
    setScheduleTime(defaultScheduleDate())
    setRows((prev) => [...prev, data as Milestone])
    onCountsChanged?.()
    void notifyExpoEvent({
      kind: 'workspace_activity',
      projectId,
      activity: 'milestone',
      detail: t,
    })
  }

  const toggle = async (m: Milestone) => {
    const { error } = await supabase
      .from('project_milestones')
      .update({ completed: !m.completed })
      .eq('id', m.id)
    if (error) {
      Alert.alert('Update failed', error.message)
      return
    }
    setRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, completed: !r.completed } : r)))
    onCountsChanged?.()
  }

  const remove = (m: Milestone) => {
    Alert.alert('Remove milestone', m.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('project_milestones').delete().eq('id', m.id)
          if (error) {
            Alert.alert('Delete failed', error.message)
            return
          }
          setRows((prev) => prev.filter((r) => r.id !== m.id))
          onCountsChanged?.()
        },
      },
    ])
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.hint}>
        {canManage
          ? 'Add delivery steps with an optional date and time — helpful for handoffs and reviews.'
          : 'Check off steps as you go. Only the company or lead can edit the list.'}
      </Text>

      {canManage ? (
        <View style={styles.addCard}>
          <TextInput
            style={styles.input}
            placeholder="Milestone title (e.g. Rough cut delivery)"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={newTitle}
            onChangeText={setNewTitle}
            onSubmitEditing={add}
          />

          <TouchableOpacity
            style={styles.scheduleToggle}
            onPress={() => setScheduleEnabled((v) => !v)}
            activeOpacity={0.8}
          >
            <View style={[styles.scheduleCheck, scheduleEnabled && styles.scheduleCheckOn]}>
              {scheduleEnabled ? <Check size={14} color="#0a0a0a" strokeWidth={ICON_STROKE} /> : null}
            </View>
            <Text style={styles.scheduleToggleText}>Set delivery date & time</Text>
          </TouchableOpacity>

          {scheduleEnabled ? (
            <View style={styles.scheduleRow}>
              <TouchableOpacity style={styles.scheduleBtn} onPress={() => setPickerMode('date')}>
                <CalendarClock size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
                <Text style={styles.scheduleBtnText}>
                  {scheduleDate.toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.scheduleBtn} onPress={() => setPickerMode('time')}>
                <Text style={styles.scheduleBtnText}>
                  {scheduleTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {pickerMode ? (
            <DateTimePicker
              value={pickerMode === 'date' ? scheduleDate : scheduleTime}
              mode={pickerMode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onPickerChange}
            />
          ) : null}

          <TouchableOpacity style={[styles.addBtnWide, busy && styles.dim]} onPress={add} disabled={busy}>
            <Plus size={20} color="#0a0a0a" strokeWidth={ICON_STROKE} />
            <Text style={styles.addBtnWideText}>{busy ? 'Adding…' : 'Add milestone'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {rows.length === 0 ? (
        <Text style={styles.empty}>
          {canManage ? 'No milestones yet — add the first one above.' : 'No milestones yet.'}
        </Text>
      ) : (
        rows.map((m) => {
          const when = formatMilestoneSchedule(m.scheduled_at)
          return (
            <View key={m.id} style={styles.row}>
              <TouchableOpacity style={styles.checkWrap} onPress={() => toggle(m)} hitSlop={8}>
                {m.completed ? (
                  <View style={styles.checkOn}>
                    <Check size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
                  </View>
                ) : (
                  <View style={styles.checkOff} />
                )}
              </TouchableOpacity>
              <View style={styles.rowBody}>
                <Text style={[styles.title, m.completed && styles.titleDone]}>{m.title}</Text>
                {when ? <Text style={styles.when}>Delivery: {when}</Text> : null}
              </View>
              {canManage ? (
                <TouchableOpacity onPress={() => remove(m)} hitSlop={8}>
                  <Trash2 size={18} color="rgba(255,255,255,0.25)" strokeWidth={ICON_STROKE} />
                </TouchableOpacity>
              ) : (
                <View style={styles.trashSpacer} />
              )}
            </View>
          )
        })
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: 32 },
  center: { paddingVertical: 40, alignItems: 'center' },
  hint: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18, marginBottom: 16 },
  addCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 20,
    gap: 12,
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  scheduleToggle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scheduleCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleCheckOn: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  scheduleToggleText: { fontSize: 14, color: 'rgba(255,255,255,0.75)', fontWeight: '600' },
  scheduleRow: { flexDirection: 'row', gap: 8 },
  scheduleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
    backgroundColor: 'rgba(255,220,0,0.08)',
  },
  scheduleBtnText: { color: '#FFDC00', fontSize: 14, fontWeight: '600' },
  addBtnWide: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFDC00',
    borderRadius: 12,
    paddingVertical: 14,
  },
  addBtnWideText: { color: '#0a0a0a', fontSize: 15, fontWeight: '800' },
  dim: { opacity: 0.5 },
  empty: { fontSize: 14, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  checkWrap: { padding: 4, marginTop: 2 },
  checkOff: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  checkOn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 4 },
  title: { fontSize: 15, color: 'rgba(255,255,255,0.9)' },
  titleDone: { textDecorationLine: 'line-through', color: 'rgba(255,255,255,0.35)' },
  when: { fontSize: 12, color: 'rgba(255,220,0,0.75)', fontWeight: '500' },
  trashSpacer: { width: 18 },
})
