import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { KeyboardAwareScrollView } from '@/components/KeyboardAwareScrollView'
import { useRouter } from 'expo-router'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { isFreelancerProfile } from '@/lib/profileRole'
import {
  type CalendarDefaultMode,
  type CellState,
  DAY_LABELS_EN,
  effectiveDayStateMap,
  toISODateLocal,
  toJsonPayload,
} from '@/lib/availabilityCalendar'
import { addMonths, buildMonthSlotMatrix, formatMonthTitle } from '@/lib/calendarMonth'
import {
  readCachedAvailability,
  hydrateAvailabilityFromDisk,
  loadAvailabilityCache,
  cacheAvailability,
} from '@/lib/availabilityCache'
import { peekWarmedOverview } from '@/lib/warmAppCaches'
import { ScreenListSkeleton } from '@/components/ScreenSkeletons'

function readInitialAvailability(): {
  loading: boolean
  role: string | null
  days: Record<string, CellState>
  notes: string
  defaultMode: CalendarDefaultMode
} {
  const uid = peekWarmedOverview()?.userId
  if (!uid) {
    return { loading: true, role: null, days: {}, notes: '', defaultMode: 'available' }
  }
  const cached = readCachedAvailability(uid)
  if (!cached) {
    return { loading: true, role: null, days: {}, notes: '', defaultMode: 'available' }
  }
  return {
    loading: false,
    role: cached.role,
    days: cached.days,
    notes: cached.notes,
    defaultMode: cached.defaultMode,
  }
}

type MonthPageProps = {
  pageWidth: number
  year: number
  monthIndex: number
  days: Record<string, CellState>
  defaultMode: CalendarDefaultMode
  todayISO: string
  selectedIsos: ReadonlySet<string>
  onTapDay: (iso: string) => void
  onShiftMonth: (delta: number) => void
}

function MonthPage({
  pageWidth,
  year,
  monthIndex,
  days,
  defaultMode,
  todayISO,
  selectedIsos,
  onTapDay,
  onShiftMonth,
}: MonthPageProps) {
  const slotMatrix = useMemo(() => buildMonthSlotMatrix(year, monthIndex), [year, monthIndex])

  const rows: ReactNode[] = []
  for (let ri = 0; ri < slotMatrix.length; ri++) {
    const rowSlots = slotMatrix[ri]
    rows.push(
      <View key={ri} style={styles.weekRow} collapsable={false}>
        {rowSlots.map((iso, ci) => {
          if (iso == null) {
            return <View key={`e-${ri}-${ci}`} style={[styles.dayCell, styles.dayCellEmpty]} />
          }
          const st = effectiveDayStateMap(days, iso, defaultMode)
          const isToday = iso === todayISO
              const isSelected = selectedIsos.has(iso)
          const dayNum = parseInt(iso.slice(8, 10), 10)
          return (
            <Pressable
              key={iso}
              accessibilityRole="button"
              accessibilityLabel={`Day ${dayNum}`}
                  onPress={() => onTapDay(iso)}
              style={({ pressed }) => [
                styles.dayCell,
                st === 'off' && styles.cellOff,
                st === 'available' && styles.cellAvailable,
                st === 'booked' && styles.cellBooked,
                isToday && styles.cellTodayRing,
                    isSelected && styles.cellSelectionRing,
                pressed && styles.dayCellPressed,
              ]}
            >
              <Text style={[styles.dayNum, st === 'off' && styles.dayNumMuted]}>{dayNum}</Text>
            </Pressable>
          )
        })}
      </View>
    )
  }

  return (
    <View style={[styles.monthPage, { width: pageWidth }]}>
      <View style={styles.monthTitleRow}>
        <TouchableOpacity
          onPress={() => onShiftMonth(-1)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={styles.monthNavHit}
        >
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{formatMonthTitle(year, monthIndex)}</Text>
        <TouchableOpacity
          onPress={() => onShiftMonth(1)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          style={styles.monthNavHit}
        >
          <ChevronRight size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
      </View>
      <View style={styles.dayHeaderRow}>
        {DAY_LABELS_EN.map((d) => (
          <Text key={d} style={styles.dayHeader}>
            {d}
          </Text>
        ))}
      </View>
      <View
        style={styles.gridTouchLayer}
        collapsable={false}
      >
        {rows}
      </View>
    </View>
  )
}

export default function AvailabilityScreen() {
  const router = useRouter()
  const { width: windowWidth } = useWindowDimensions()
  const cardGutter = 12
  const pageWidth = Math.max(280, windowWidth - cardGutter * 2)

  const boot = useRef(readInitialAvailability()).current
  const [loading, setLoading] = useState(boot.loading)
  const [saving, setSaving] = useState(false)
  const [role, setRole] = useState<string | null>(boot.role)
  const [days, setDays] = useState<Record<string, CellState>>(boot.days)
  const [defaultMode, setDefaultMode] = useState<CalendarDefaultMode>(boot.defaultMode)
  const [notes, setNotes] = useState(boot.notes)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1, 12, 0, 0, 0)
  })

  const todayISO = toISODateLocal(new Date())
  const [selectionMode, setSelectionMode] = useState<'tap' | 'range'>('tap')
  const [rangeStartIso, setRangeStartIso] = useState<string | null>(null)
  const [selectedIsos, setSelectedIsos] = useState<Set<string>>(new Set())
  const [applyState, setApplyState] = useState<CellState>('available')

  const load = useCallback(async () => {
    setLoadError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    let cached = readCachedAvailability(user.id)
    if (!cached) {
      await hydrateAvailabilityFromDisk(user.id)
      cached = readCachedAvailability(user.id)
    }
    if (cached) {
      setRole(cached.role)
      if (isFreelancerProfile(cached.role)) {
        setDays(cached.days)
        setNotes(cached.notes)
        setDefaultMode(cached.defaultMode)
      }
      setLoading(false)
    }

    const next = await loadAvailabilityCache(user.id)
    if (!next) {
      setLoadError('Could not load availability')
      setLoading(false)
      return
    }

    setRole(next.role)
    if (isFreelancerProfile(next.role)) {
      setDays(next.days)
      setNotes(next.notes)
      setDefaultMode(next.defaultMode)
    }
    cacheAvailability(user.id, next)
    setLoading(false)
  }, [loading])

  useEffect(() => {
    load()
  }, [load])

  const shiftMonth = useCallback((delta: number) => {
    setCursor((c) => addMonths(c, delta))
    setSelectedIsos(new Set())
    setRangeStartIso(null)
  }, [])

  const onTapDay = useCallback((iso: string) => {
    if (selectionMode === 'tap') {
      setSelectedIsos((prev) => {
        const next = new Set(prev)
        if (next.has(iso)) next.delete(iso)
        else next.add(iso)
        return next
      })
      return
    }
    if (!rangeStartIso) {
      setRangeStartIso(iso)
      setSelectedIsos(new Set([iso]))
      return
    }
    const a = new Date(`${rangeStartIso}T12:00:00`)
    const b = new Date(`${iso}T12:00:00`)
    const from = a <= b ? a : b
    const to = a <= b ? b : a
    const next = new Set<string>()
    const cur = new Date(from)
    while (cur <= to) {
      next.add(toISODateLocal(cur))
      cur.setDate(cur.getDate() + 1)
    }
    setSelectedIsos(next)
    setRangeStartIso(null)
  }, [selectionMode, rangeStartIso])

  const applySelection = useCallback(() => {
    if (selectedIsos.size === 0) return
    setDays((prev) => {
      const next = { ...prev }
      selectedIsos.forEach((iso) => {
        if (applyState === defaultMode) delete next[iso]
        else next[iso] = applyState
      })
      return next
    })
    setSelectedIsos(new Set())
    setRangeStartIso(null)
  }, [selectedIsos, applyState, defaultMode])

  const save = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    setSaving(true)
    const payload = toJsonPayload(days, notes, defaultMode)
    const { error } = await supabase
      .from('profiles')
      .update({ availability_calendar: payload })
      .eq('id', user.id)

    setSaving(false)

    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }

    Alert.alert('Saved', 'Your availability calendar was updated.', [
      { text: 'OK', onPress: () => router.replace('/(tabs)/feed') },
    ])
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <ScreenListSkeleton rows={6} />
        </View>
      </SafeAreaView>
    )
  }

  if (!isFreelancerProfile(role)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.replace('/(tabs)/feed')}
            hitSlop={12}
          >
            <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.backLabel}>Dashboard</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.blockedWrap}>
          <Text style={styles.blockedTitle}>Freelancers only</Text>
          <Text style={styles.blockedSub}>Companies can’t set availability here.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.flex}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.replace('/(tabs)/feed')}
            hitSlop={12}
          >
            <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.backLabel}>Dashboard</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAwareScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          extraBottomPadding={24}
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
        >
          <Text style={styles.kicker}>AVAILABILITY</Text>
          <Text style={styles.title}>Set it once.</Text>
          <Text style={styles.titleAccent}>Everyone sees it.</Text>
          <Text style={styles.subtitle}>
            Use arrows to change month. Select with Tap or Range, then apply.
            {defaultMode === 'available'
              ? ' Open (green) is the default; mark grey where you are not free.'
              : ' Empty days are blocked until you mark them free (older calendar format).'}
          </Text>

          {loadError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>Couldn’t load data</Text>
              <Text style={styles.errorText}>{loadError}</Text>
              <Text style={styles.errorHint}>
                Run <Text style={styles.errorMono}>supabase/sql/add_profile_availability.sql</Text> in the Supabase SQL
                editor.
              </Text>
            </View>
          ) : null}

          <View style={styles.modeRow}>
            <TouchableOpacity
              onPress={() => {
                setSelectionMode('tap')
                setRangeStartIso(null)
              }}
              style={[styles.modeChip, selectionMode === 'tap' && styles.modeChipOn]}
            >
              <Text style={[styles.modeChipText, selectionMode === 'tap' && styles.modeChipTextOn]}>Tap</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setSelectionMode('range')
                setRangeStartIso(null)
              }}
              style={[styles.modeChip, selectionMode === 'range' && styles.modeChipOn]}
            >
              <Text style={[styles.modeChipText, selectionMode === 'range' && styles.modeChipTextOn]}>Range</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setApplyState('available')} style={[styles.modeChip, applyState === 'available' && styles.modeChipOn]}>
              <Text style={[styles.modeChipText, applyState === 'available' && styles.modeChipTextOn]}>Set Free</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setApplyState('off')} style={[styles.modeChip, applyState === 'off' && styles.modeChipOn]}>
              <Text style={[styles.modeChipText, applyState === 'off' && styles.modeChipTextOn]}>Set Off</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.applyBtn, selectedIsos.size === 0 && styles.applyBtnDim]}
              disabled={selectedIsos.size === 0}
              onPress={applySelection}
            >
              <Text style={styles.applyBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.calendarCard, { marginHorizontal: cardGutter }]}>
            <MonthPage
              pageWidth={pageWidth}
              year={cursor.getFullYear()}
              monthIndex={cursor.getMonth()}
              days={days}
              defaultMode={defaultMode}
              todayISO={todayISO}
              selectedIsos={selectedIsos}
              onTapDay={onTapDay}
              onShiftMonth={shiftMonth}
            />
            <Text style={styles.selectionInfo}>
              {selectedIsos.size > 0
                ? `${selectedIsos.size} day${selectedIsos.size === 1 ? '' : 's'} selected`
                : rangeStartIso
                  ? `Range start: ${rangeStartIso}`
                  : 'No days selected'}
            </Text>

            <View style={styles.legend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.legendAvailable]} />
                <Text style={styles.legendText}>Available</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.legendBooked]} />
                <Text style={styles.legendText}>Booked</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, styles.legendToday]} />
                <Text style={styles.legendText}>Today</Text>
              </View>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Note (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. remote only, prefer after 2pm …"
            placeholderTextColor="rgba(255,255,255,0.28)"
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={400}
            textAlignVertical="top"
          />

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={save}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </KeyboardAwareScrollView>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
  topBar: { paddingHorizontal: 12, paddingBottom: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 8 },
  backLabel: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: {},
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFDC00',
    letterSpacing: 2,
    marginBottom: 10,
    paddingHorizontal: 20,
  },
  title: { fontSize: 26, fontWeight: '900', color: '#ffffff', letterSpacing: 0.3, paddingHorizontal: 20 },
  titleAccent: {
    fontSize: 26,
    fontWeight: '900',
    color: '#FFDC00',
    letterSpacing: 0.3,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.38)',
    lineHeight: 20,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  modeChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#111',
  },
  modeChipOn: {
    borderColor: '#FFDC00',
    backgroundColor: 'rgba(255,220,0,0.12)',
  },
  modeChipText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  modeChipTextOn: { color: '#FFDC00' },
  applyBtn: {
    marginLeft: 'auto',
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  applyBtnDim: { opacity: 0.45 },
  applyBtnText: { fontSize: 11, fontWeight: '800', color: '#0a0a0a' },
  calendarCard: {
    backgroundColor: '#111111',
    borderRadius: 20,
    paddingVertical: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  monthPage: { paddingHorizontal: 8 },
  gridTouchLayer: { flexGrow: 0 },
  dayCellPressed: { opacity: 0.85 },
  monthTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 2,
    gap: 4,
  },
  monthNavHit: { paddingVertical: 4, paddingHorizontal: 2 },
  monthTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  dayHeaderRow: { flexDirection: 'row', marginBottom: 8, gap: 4 },
  dayHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.3,
  },
  weekRow: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCellEmpty: { backgroundColor: 'transparent', borderWidth: 0 },
  dayNum: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  dayNumMuted: { color: 'rgba(255,255,255,0.35)' },
  cellOff: { backgroundColor: '#0d0d0d' },
  cellAvailable: { backgroundColor: '#1a3d2e', borderColor: 'rgba(80,180,120,0.25)' },
  cellBooked: { backgroundColor: '#321818', borderColor: 'rgba(200,80,80,0.25)' },
  cellTodayRing: { borderWidth: 2, borderColor: '#FFDC00' },
  cellSelectionRing: { borderWidth: 2, borderColor: '#ffffff' },
  selectionInfo: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 10,
    marginHorizontal: 16,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 14,
    marginHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendAvailable: { backgroundColor: '#2a6b4a' },
  legendBooked: { backgroundColor: '#6b2a2a' },
  legendToday: { backgroundColor: '#FFDC00' },
  legendText: { fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  sectionLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 10,
    paddingHorizontal: 20,
  },
  input: {
    minHeight: 88,
    backgroundColor: '#111111',
    borderRadius: 16,
    padding: 16,
    fontSize: 15,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 20,
    marginHorizontal: 20,
  },
  saveBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 100,
    paddingVertical: 16,
    alignItems: 'center',
    marginHorizontal: 20,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: '800', color: '#0a0a0a' },
  errorBox: {
    marginBottom: 20,
    marginHorizontal: 20,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,80,80,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,80,80,0.25)',
  },
  errorTitle: { color: '#ff8888', fontWeight: '700', marginBottom: 6 },
  errorText: { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginBottom: 8 },
  errorHint: { color: 'rgba(255,255,255,0.35)', fontSize: 11, lineHeight: 16 },
  errorMono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10 },
  blockedWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  blockedTitle: { fontSize: 20, fontWeight: '800', color: '#ffffff', marginBottom: 10 },
  blockedSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 20 },
})
