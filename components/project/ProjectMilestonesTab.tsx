import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { Check, Plus, Trash2, CalendarClock, ChevronDown } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { ICON_STROKE } from '@/lib/iconTheme'
import { formatMilestoneSchedule, isoFromDateAndTime } from '@/lib/milestoneSchedule'
import {
  deleteWorkspaceMilestone,
  fetchWorkspaceMilestones,
  insertWorkspaceMilestone,
  MILESTONE_PRIORITY_CONFIG,
  MILESTONE_STATUS_CONFIG,
  setWorkspaceMilestoneCompleted,
  setWorkspaceMilestonePriority,
  setWorkspaceMilestoneStatus,
  type WorkspaceMilestonePriority,
  type WorkspaceMilestoneStatus,
  type WorkspaceMilestoneUi,
} from '@/lib/workspaceMilestones'
import { OfflinePackBanner } from '@/components/project/OfflinePackBanner'
import {
  detectReviewLinkKind,
  reviewLinkOpenLabel,
  type ReviewLinkKind,
} from '@/lib/reviewLinkKind'
import {
  OFFLINE_READ_ONLY_MESSAGE,
  OFFLINE_READ_ONLY_TITLE,
  isOfflineFetchError,
  readOfflinePack,
  resolveOfflineRead,
  subscribeOfflinePack,
} from '@/lib/offlinePack'

type Props = {
  projectId: string
  jobId: string | null
  onCountsChanged?: () => void
  /** Company or lead: add/remove milestones. Crew can still mark items complete when false. */
  canManage: boolean
}

const PRIORITIES: WorkspaceMilestonePriority[] = ['p1', 'p2', 'p3']
const STATUSES: WorkspaceMilestoneStatus[] = ['pending', 'in_progress', 'completed']

function defaultScheduleDate(): Date {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

function openReviewUrl(raw: string) {
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  Linking.openURL(withProto).catch(() => {
    Alert.alert('Could not open link', withProto)
  })
}

const REVIEW_CHIP_COLORS: Record<ReviewLinkKind, { border: string; background: string; text: string }> = {
  frameio: {
    border: 'rgba(91,68,255,0.4)',
    background: 'rgba(91,68,255,0.12)',
    text: '#8b7cff',
  },
  picdrop: {
    border: 'rgba(255,255,255,0.28)',
    background: 'rgba(255,255,255,0.08)',
    text: 'rgba(255,255,255,0.78)',
  },
  other: {
    border: 'rgba(255,255,255,0.18)',
    background: 'rgba(255,255,255,0.05)',
    text: 'rgba(255,255,255,0.6)',
  },
}

function reviewKindHint(kind: ReviewLinkKind): string {
  switch (kind) {
    case 'picdrop':
      return 'PicDrop — shown in white/gray'
    case 'frameio':
      return 'Frame.io — shown in purple'
    default:
      return 'Other link — shown as Review'
  }
}

export function ProjectMilestonesTab({ projectId, jobId, onCountsChanged, canManage }: Props) {
  const [rows, setRows] = useState<WorkspaceMilestoneUi[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newPriority, setNewPriority] = useState<WorkspaceMilestonePriority>('p3')
  const [newDeliverable, setNewDeliverable] = useState('')
  const [newDeliverables, setNewDeliverables] = useState<string[]>([])
  const [newFrameioUrl, setNewFrameioUrl] = useState('')
  const [addDetailsOpen, setAddDetailsOpen] = useState(false)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleDate, setScheduleDate] = useState(() => defaultScheduleDate())
  const [scheduleTime, setScheduleTime] = useState(() => defaultScheduleDate())
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null)
  const [busy, setBusy] = useState(false)
  const [usingOfflinePack, setUsingOfflinePack] = useState(false)
  const [packDownloadedAt, setPackDownloadedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    const offline = await resolveOfflineRead(projectId)
    if (offline) {
      setRows(offline.pack.milestones)
      setUsingOfflinePack(true)
      setPackDownloadedAt(offline.pack.downloadedAt)
      setLoading(false)
      return
    }
    if (!jobId) {
      setRows([])
      setUsingOfflinePack(false)
      setPackDownloadedAt(null)
      setLoading(false)
      return
    }
    const { rows: next, error } = await fetchWorkspaceMilestones(supabase, jobId)
    if (error) {
      if (isOfflineFetchError({ message: error })) {
        const pack = await readOfflinePack(projectId)
        if (pack) {
          setRows(pack.milestones)
          setUsingOfflinePack(true)
          setPackDownloadedAt(pack.downloadedAt)
          setLoading(false)
          return
        }
      }
      Alert.alert('Milestones', error)
      setRows([])
    } else {
      setRows(next)
      setUsingOfflinePack(false)
      setPackDownloadedAt(null)
    }
    setLoading(false)
  }, [jobId, projectId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    return subscribeOfflinePack((id) => {
      if (id !== projectId) return
      setLoading(true)
      void load()
    })
  }, [projectId, load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  useEffect(() => {
    if (!jobId || usingOfflinePack) return
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
  }, [jobId, load, onCountsChanged, usingOfflinePack])

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

  const addDeliverable = () => {
    const next = newDeliverable.trim()
    if (!next) return
    setNewDeliverables((prev) => [...prev, next])
    setNewDeliverable('')
  }

  const add = async () => {
    const t = newTitle.trim()
    if (!t || busy || !jobId) return
    if (usingOfflinePack) {
      Alert.alert(OFFLINE_READ_ONLY_TITLE, OFFLINE_READ_ONLY_MESSAGE)
      return
    }
    setBusy(true)
    const nextOrder = rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 0
    const { row, error } = await insertWorkspaceMilestone(supabase, {
      jobId,
      title: t,
      position: nextOrder,
      scheduledAt: scheduledIso,
      priority: newPriority,
      description: newDescription,
      deliverables: newDeliverables,
      frameioUrl: newFrameioUrl,
    })
    setBusy(false)
    if (error || !row) {
      Alert.alert('Could not add', error ?? 'Unknown error')
      return
    }
    setNewTitle('')
    setNewDescription('')
    setNewPriority('p3')
    setNewDeliverable('')
    setNewDeliverables([])
    setNewFrameioUrl('')
    setAddDetailsOpen(false)
    setScheduleEnabled(false)
    setScheduleDate(defaultScheduleDate())
    setScheduleTime(defaultScheduleDate())
    setRows((prev) => [...prev, row])
    setExpandedId(row.id)
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
    if (usingOfflinePack) {
      Alert.alert(OFFLINE_READ_ONLY_TITLE, OFFLINE_READ_ONLY_MESSAGE)
      return
    }
    const nextCompleted = !m.completed
    const { error } = await setWorkspaceMilestoneCompleted(supabase, m.id, nextCompleted)
    if (error) {
      Alert.alert('Update failed', error)
      return
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === m.id
          ? { ...r, completed: nextCompleted, status: nextCompleted ? 'completed' : 'pending' }
          : r
      )
    )
    onCountsChanged?.()
  }

  const setPriority = async (m: WorkspaceMilestoneUi, priority: WorkspaceMilestonePriority) => {
    if (!canManage || m.priority === priority) return
    if (usingOfflinePack) {
      Alert.alert(OFFLINE_READ_ONLY_TITLE, OFFLINE_READ_ONLY_MESSAGE)
      return
    }
    const { error } = await setWorkspaceMilestonePriority(supabase, m.id, priority)
    if (error) {
      Alert.alert('Update failed', error)
      return
    }
    setRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, priority } : r)))
  }

  const setStatus = async (m: WorkspaceMilestoneUi, status: WorkspaceMilestoneStatus) => {
    if (!canManage || m.status === status) return
    if (usingOfflinePack) {
      Alert.alert(OFFLINE_READ_ONLY_TITLE, OFFLINE_READ_ONLY_MESSAGE)
      return
    }
    const { error } = await setWorkspaceMilestoneStatus(supabase, m.id, status)
    if (error) {
      Alert.alert('Update failed', error)
      return
    }
    setRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, status, completed: status === 'completed' } : r)))
    onCountsChanged?.()
  }

  const remove = (m: WorkspaceMilestoneUi) => {
    if (usingOfflinePack) {
      Alert.alert(OFFLINE_READ_ONLY_TITLE, OFFLINE_READ_ONLY_MESSAGE)
      return
    }
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
          setExpandedId((id) => (id === m.id ? null : id))
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

  if (!jobId && !usingOfflinePack) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>This project is not linked to a job workspace yet.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {usingOfflinePack ? <OfflinePackBanner downloadedAt={packDownloadedAt} /> : null}
      <Text style={styles.hint}>
        {canManage
          ? 'Shared with the web workspace. Description, deliverables and review links are on each card — tap to expand status and priority.'
          : 'Shared with the web workspace. Description, deliverables and review links are on each card — tap to expand more details.'}
      </Text>

      {canManage && !usingOfflinePack ? (
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

          <TouchableOpacity
            style={styles.detailsToggle}
            onPress={() => setAddDetailsOpen((v) => !v)}
            activeOpacity={0.8}
          >
            <Text style={styles.detailsToggleText}>Description, deliverables & review link</Text>
            <ChevronDown
              size={18}
              color="rgba(255,255,255,0.4)"
              strokeWidth={ICON_STROKE}
              style={{ transform: [{ rotate: addDetailsOpen ? '180deg' : '0deg' }] }}
            />
          </TouchableOpacity>

          {addDetailsOpen ? (
            <View style={styles.addDetails}>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="What needs to happen..."
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={newDescription}
                onChangeText={setNewDescription}
                multiline
              />
              <View style={styles.deliverableAddRow}>
                <TextInput
                  style={[styles.input, styles.deliverableInput]}
                  placeholder="Add a deliverable..."
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  value={newDeliverable}
                  onChangeText={setNewDeliverable}
                  onSubmitEditing={addDeliverable}
                  returnKeyType="done"
                />
                <TouchableOpacity style={styles.deliverableAddBtn} onPress={addDeliverable} activeOpacity={0.8}>
                  <Plus size={18} color="rgba(255,255,255,0.7)" strokeWidth={ICON_STROKE} />
                </TouchableOpacity>
              </View>
              {newDeliverables.length > 0 ? (
                <View style={styles.deliverableChips}>
                  {newDeliverables.map((d, i) => (
                    <TouchableOpacity
                      key={`${d}-${i}`}
                      style={styles.deliverableChip}
                      onPress={() => setNewDeliverables((prev) => prev.filter((_, j) => j !== i))}
                    >
                      <Text style={styles.deliverableChipText}>{d}</Text>
                      <Text style={styles.deliverableChipRemove}>✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              <TextInput
                style={styles.input}
                placeholder="https://app.frame.io/… or picdrop.com/…"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={newFrameioUrl}
                onChangeText={setNewFrameioUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              {newFrameioUrl.trim() ? (
                <Text
                  style={[
                    styles.reviewHint,
                    { color: REVIEW_CHIP_COLORS[detectReviewLinkKind(newFrameioUrl)].text },
                  ]}
                >
                  {reviewKindHint(detectReviewLinkKind(newFrameioUrl))}
                </Text>
              ) : null}
            </View>
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
          const statusCfg = MILESTONE_STATUS_CONFIG[m.status]
          const isExpanded = expandedId === m.id
          const reviewKind = m.frameioUrl ? detectReviewLinkKind(m.frameioUrl) : null
          const reviewColors = reviewKind ? REVIEW_CHIP_COLORS[reviewKind] : null
          return (
            <Pressable
              key={m.id}
              onPress={() => setExpandedId(isExpanded ? null : m.id)}
              style={[
                styles.card,
                {
                  backgroundColor: cfg.bg,
                  borderColor: cfg.border,
                },
              ]}
            >
              <View style={styles.row}>
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
                  <View style={styles.summary}>
                    <View style={styles.titleRow}>
                      <Text style={[styles.title, m.completed && styles.titleDone]}>{m.title}</Text>
                      <View style={[styles.badge, { borderColor: cfg.border, backgroundColor: cfg.bg }]}>
                        <View style={[styles.priorityDot, { backgroundColor: cfg.color }]} />
                        <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.short}</Text>
                      </View>
                      <View style={[styles.badge, { borderColor: statusCfg.border, backgroundColor: statusCfg.bg }]}>
                        <Text style={[styles.badgeText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
                      </View>
                    </View>
                    {m.description ? (
                      <Text style={styles.descriptionPreview} numberOfLines={isExpanded ? undefined : 3}>
                        {m.description}
                      </Text>
                    ) : (
                      <Text style={styles.expandedEmpty}>No description</Text>
                    )}
                    {when ? <Text style={styles.when}>Delivery: {when}</Text> : null}
                  </View>
                  {m.frameioUrl && reviewColors && reviewKind ? (
                    <TouchableOpacity
                      style={[
                        styles.frameioChip,
                        {
                          borderColor: reviewColors.border,
                          backgroundColor: reviewColors.background,
                        },
                      ]}
                      onPress={() => openReviewUrl(m.frameioUrl!)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.frameioChipText, { color: reviewColors.text }]}>
                        {reviewLinkOpenLabel(reviewKind)}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {m.deliverables.length > 0 ? (
                    <View style={styles.expandedBlock}>
                      <Text style={styles.expandedLabel}>Deliverables</Text>
                      {(isExpanded ? m.deliverables : m.deliverables.slice(0, 3)).map((d, i) => (
                        <View key={`${m.id}-d-${i}`} style={styles.deliverableRow}>
                          <View style={[styles.deliverableCheck, m.completed && styles.deliverableCheckOn]}>
                            {m.completed ? <Check size={10} color="#4ade80" strokeWidth={ICON_STROKE} /> : null}
                          </View>
                          <Text style={[styles.deliverableText, m.completed && styles.titleDone]}>{d}</Text>
                        </View>
                      ))}
                      {!isExpanded && m.deliverables.length > 3 ? (
                        <Text style={styles.expandHint}>+{m.deliverables.length - 3} more · tap to expand</Text>
                      ) : null}
                    </View>
                  ) : (
                    <Text style={styles.expandedEmpty}>No deliverables listed</Text>
                  )}
                  {!isExpanded ? <Text style={styles.expandHint}>Tap card to expand</Text> : null}
                </View>
                {canManage ? (
                  <TouchableOpacity onPress={() => remove(m)} hitSlop={8}>
                    <Trash2 size={18} color="rgba(255,255,255,0.25)" strokeWidth={ICON_STROKE} />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.trashSpacer} />
                )}
                <ChevronDown
                  size={18}
                  color="rgba(255,255,255,0.45)"
                  strokeWidth={ICON_STROKE}
                  style={{ transform: [{ rotate: isExpanded ? '180deg' : '0deg' }], marginTop: 4 }}
                />
              </View>

              {isExpanded && canManage ? (
                <View style={styles.expanded}>
                  <View style={styles.expandedBlock}>
                    <Text style={styles.expandedLabel}>Priority</Text>
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
                  </View>
                  <View style={styles.expandedBlock}>
                    <Text style={styles.expandedLabel}>Update status</Text>
                    <View style={styles.statusColumn}>
                      {STATUSES.map((s) => {
                        const sCfg = MILESTONE_STATUS_CONFIG[s]
                        const active = m.status === s
                        return (
                          <TouchableOpacity
                            key={s}
                            style={[
                              styles.statusChip,
                              {
                                borderColor: active ? sCfg.border : 'rgba(255,255,255,0.08)',
                                backgroundColor: active ? sCfg.bg : 'transparent',
                              },
                            ]}
                            onPress={() => void setStatus(m, s)}
                            activeOpacity={0.8}
                          >
                            <Text style={[styles.statusChipText, { color: active ? sCfg.color : 'rgba(255,255,255,0.3)' }]}>
                              {sCfg.label}
                            </Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </View>
                </View>
              ) : null}
            </Pressable>
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
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
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
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailsToggleText: { fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  addDetails: { gap: 10 },
  deliverableAddRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  deliverableInput: { flex: 1 },
  deliverableAddBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  deliverableChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  deliverableChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  deliverableChipText: { fontSize: 12, color: 'rgba(255,255,255,0.65)' },
  deliverableChipRemove: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
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
  card: {
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
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
  rowBody: { flex: 1, gap: 8 },
  summary: { gap: 6 },
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
  descriptionPreview: { fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 18 },
  when: { fontSize: 12, color: 'rgba(255,220,0,0.75)', fontWeight: '500' },
  trashSpacer: { width: 18 },
  expanded: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 14,
  },
  expandedBlock: { gap: 8 },
  expandedLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
  },
  expandedEmpty: { fontSize: 12, color: 'rgba(255,255,255,0.28)' },
  expandHint: { fontSize: 11, color: 'rgba(255,220,0,0.65)', fontWeight: '600', marginTop: 2 },
  reviewHint: { fontSize: 11, fontWeight: '600', marginTop: 2 },
  frameioChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(91,68,255,0.4)',
    backgroundColor: 'rgba(91,68,255,0.12)',
  },
  frameioChipText: { fontSize: 12, fontWeight: '700', color: '#8b7cff' },
  deliverableRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deliverableCheck: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  deliverableCheckOn: { borderColor: 'rgba(74,222,128,0.4)', backgroundColor: 'rgba(34,197,94,0.12)' },
  deliverableText: { fontSize: 14, color: 'rgba(255,255,255,0.7)', flex: 1 },
  priorityRowCompact: { flexDirection: 'row', gap: 6 },
  priorityChipCompact: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  priorityChipCompactText: { fontSize: 11, fontWeight: '700' },
  statusColumn: { gap: 6 },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusChipText: { fontSize: 12, fontWeight: '700' },
})
