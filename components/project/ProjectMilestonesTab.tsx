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
import { useFocusEffect } from 'expo-router'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Check, Plus, Trash2, CalendarClock } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { ICON_STROKE } from '@/lib/iconTheme'
import { formatMilestoneSchedule, isoFromDateAndTime } from '@/lib/milestoneSchedule'
import {
  deleteWorkspaceMilestone,
  fetchWorkspaceMilestones,
  insertWorkspaceMilestone,
  MILESTONE_PRIORITY_CONFIG,
  setWorkspaceMilestoneCompleted,
  setWorkspaceMilestonePriority,
  type WorkspaceMilestonePriority,
  type WorkspaceMilestoneUi,
} from '@/lib/workspaceMilestones'

type Props = {
  projectId: string
  jobId: string | null
  onCountsChanged?: () => void
  /** Company or lead: add/remove milestones. Crew can still mark items complete when false. */
  canManage: boolean
}

const PRIORITIES: WorkspaceMilestonePriority[] = ['p1', 'p2', 'p3']

function defaultScheduleDate(): Date {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

export function ProjectMilestonesTab({ projectId, jobId, onCountsChanged, canManage }: Props) {
  const [rows, setRows] = useState<WorkspaceMilestoneUi[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState<WorkspaceMilestonePriority>('p3')
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleDate, setScheduleDate] = useState(() => defaultScheduleDate())
  const [scheduleTime, setScheduleTime] = useState(() => defaultScheduleDate())
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!jobId) {
      setRows([])
      setLoading(false)
      return
    }
    const { rows: next, error } = await fetchWorkspaceMilestones(supabase, jobId)
    if (error) {
      Alert.alert('Milestones', error)
      setRows([])
    } else {
      setRows(next)
    }
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    if (!jobId) return
    const channel = supabase
      .channel(`workspace-milestones-${jobId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'milestones', filter: `job_id=eq.${jobId}` },
        () => {
          void load()
          onCountsChanged?.()
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [jobId, load, onCountsChanged])

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
    if (!t || busy || !jobId) return
    setBusy(true)
    const nextOrder = rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 0
    const { row, error } = await insertWorkspaceMilestone(supabase, {
      jobId,
      title: t,
      position: nextOrder,
      scheduledAt: scheduledIso,
      priority: newPriority,
    })
    setBusy(false)
    if (error || !row) {
      Alert.alert('Could not add', error ?? 'Unknown error')
      return
    }
    setNewTitle('')
    setNewPriority('p3')
    setScheduleEnabled(false)
    setScheduleDate(defaultScheduleDate())
    setScheduleTime(defaultScheduleDate())
    setRows((prev) => [...prev, row])
    onCountsChanged?.()
    void notifyExpoEvent({
      kind: 'workspace_activity',
      jobId,
      projectId,
      activity: 'milestone',
      detail: t,
    })
  }

  const toggle = async (m: WorkspaceMilestoneUi) => {
    const { error } = await setWorkspaceMilestoneCompleted(supabase, m.id, !m.completed)
    if (error) {
      Alert.alert('Update failed', error)
      return
    }
    setRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, completed: !r.completed } : r)))
    onCountsChanged?.()
  }

  const setPriority = async (m: WorkspaceMilestoneUi, priority: WorkspaceMilestonePriority) => {
    if (!canManage || m.priority === priority) return
    const { error } = await setWorkspaceMilestonePriority(supabase, m.id, priority)
    if (error) {
      Alert.alert('Update failed', error)
      return
    }
    setRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, priority } : r)))
  }

  const remove = (m: WorkspaceMilestoneUi) => {
    Alert.alert('Remove milestone', m.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await deleteWorkspaceMilestone(supabase, m.id)
          if (error) {
            Alert.alert('Delete failed', error)
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

  if (!jobId) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>This project is not linked to a job workspace yet.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.hint}>
        {canManage
          ? 'Shared with the web workspace — add delivery steps with priority and an optional date and time.'
          : 'Shared with the web workspace. Check off steps as you go; only the company or lead can edit the list.'}
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

          <Text style={styles.priorityLabel}>Priority</Text>
          <View style={styles.priorityRow}>
            {PRIORITIES.map((p) => {
              const cfg = MILESTONE_PRIORITY_CONFIG[p]
              const active = newPriority === p
              return (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.priorityChip,
                    {
                      borderColor: active ? cfg.border : 'rgba(255,255,255,0.08)',
                      backgroundColor: active ? cfg.bg : 'transparent',
                    },
                  ]}
                  onPress={() => setNewPriority(p)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.priorityDot, { backgroundColor: cfg.color }]} />
                  <Text style={[styles.priorityChipText, { color: active ? cfg.color : 'rgba(255,255,255,0.35)' }]}>
                    {cfg.short}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

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
          const when = formatMilestoneSchedule(m.scheduledAt)
          const cfg = MILESTONE_PRIORITY_CONFIG[m.priority]
          return (
            <View
              key={m.id}
              style={[
                styles.row,
                {
                  backgroundColor: cfg.bg,
                  borderColor: cfg.border,
                },
              ]}
            >
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
                <View style={styles.titleRow}>
                  <Text style={[styles.title, m.completed && styles.titleDone]}>{m.title}</Text>
                  <View style={[styles.badge, { borderColor: cfg.border, backgroundColor: cfg.bg }]}>
                    <View style={[styles.priorityDot, { backgroundColor: cfg.color }]} />
                    <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.short}</Text>
                  </View>
                </View>
                {when ? <Text style={styles.when}>Delivery: {when}</Text> : null}
                {canManage ? (
                  <View style={styles.priorityRowCompact}>
                    {PRIORITIES.map((p) => {
                      const pCfg = MILESTONE_PRIORITY_CONFIG[p]
                      const active = m.priority === p
                      return (
                        <TouchableOpacity
                          key={p}
                          style={[
                            styles.priorityChipCompact,
                            {
                              borderColor: active ? pCfg.border : 'rgba(255,255,255,0.08)',
                              backgroundColor: active ? pCfg.bg : 'transparent',
                            },
                          ]}
                          onPress={() => void setPriority(m, p)}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[
                              styles.priorityChipCompactText,
                              { color: active ? pCfg.color : 'rgba(255,255,255,0.3)' },
                            ]}
                          >
                            {pCfg.short}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                ) : null}
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
  center: { paddingVertical: 40, alignItems: 'center', paddingHorizontal: 20 },
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
  priorityLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
  },
  priorityRow: { flexDirection: 'row', gap: 8 },
  priorityChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  priorityChipText: { fontSize: 13, fontWeight: '700' },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
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
  empty: { fontSize: 14, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
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
  rowBody: { flex: 1, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { fontSize: 15, color: 'rgba(255,255,255,0.9)', flexShrink: 1 },
  titleDone: { textDecorationLine: 'line-through', color: 'rgba(255,255,255,0.35)' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  when: { fontSize: 12, color: 'rgba(255,220,0,0.75)', fontWeight: '500' },
  priorityRowCompact: { flexDirection: 'row', gap: 6, marginTop: 2 },
  priorityChipCompact: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  priorityChipCompactText: { fontSize: 11, fontWeight: '700' },
  trashSpacer: { width: 18 },
})
