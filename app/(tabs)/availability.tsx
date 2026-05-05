import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  PanResponder,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
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
  nextCellState,
  parseAvailabilityCalendar,
  toISODateLocal,
  toJsonPayload,
} from '@/lib/availabilityCalendar'
import { addMonths, buildMonthSlotMatrix, formatMonthTitle } from '@/lib/calendarMonth'

const TAB_BAR_HEIGHT = 80

const CELL_GAP = 4
/** Below slop: no paint mode — vertical scroll / small moves stay on outer ScrollView or Pressable. */
const PAINT_MOVE_SLOP = 10

type GridMetrics = { cellW: number; rowH: number; numRows: number }

type MonthPageProps = {
  pageWidth: number
  year: number
  monthIndex: number
  days: Record<string, CellState>
  defaultMode: CalendarDefaultMode
  todayISO: string
  onPaintDay: (iso: string, target: CellState) => void
  onShiftMonth: (delta: number) => void
}

function hitTestIso(
  x: number,
  y: number,
  metrics: GridMetrics,
  slotMatrix: (string | null)[][]
): string | null {
  const { cellW, rowH, numRows } = metrics
  let yRem = y
  for (let ri = 0; ri < numRows; ri++) {
    if (yRem >= 0 && yRem < rowH) {
      let xRem = x
      for (let ci = 0; ci < 7; ci++) {
        if (xRem >= 0 && xRem < cellW) {
          const iso = slotMatrix[ri]?.[ci] ?? null
          return iso
        }
        xRem -= cellW + CELL_GAP
      }
      return null
    }
    yRem -= rowH + CELL_GAP
  }
  return null
}

function MonthPage({
  pageWidth,
  year,
  monthIndex,
  days,
  defaultMode,
  todayISO,
  onPaintDay,
  onShiftMonth,
}: MonthPageProps) {
  const slotMatrix = useMemo(() => buildMonthSlotMatrix(year, monthIndex), [year, monthIndex])
  const [metrics, setMetrics] = useState<GridMetrics | null>(null)
  const daysRef = useRef(days)
  daysRef.current = days

  useEffect(() => {
    setMetrics(null)
  }, [year, monthIndex])

  const visitedRef = useRef(new Set<string>())
  const paintTargetRef = useRef<CellState | null>(null)

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Start paint mode immediately on touch-down so drag selection is reliable.
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: (_, gs) => {
          const ax = Math.abs(gs.dx)
          const ay = Math.abs(gs.dy)
          if (ax < PAINT_MOVE_SLOP && ay < PAINT_MOVE_SLOP) return false
          return true
        },
        onMoveShouldSetPanResponderCapture: (_, gs) => {
          const ax = Math.abs(gs.dx)
          const ay = Math.abs(gs.dy)
          return ax >= PAINT_MOVE_SLOP || ay >= PAINT_MOVE_SLOP
        },
        onPanResponderTerminationRequest: () => true,

        onPanResponderGrant: (evt) => {
          if (!metrics) return
          visitedRef.current.clear()
          paintTargetRef.current = null
          const { locationX, locationY } = evt.nativeEvent
          const iso = hitTestIso(locationX, locationY, metrics, slotMatrix)
          if (iso) {
            const cur = effectiveDayStateMap(daysRef.current, iso, defaultMode)
            paintTargetRef.current = nextCellState(cur)
            visitedRef.current.add(iso)
            onPaintDay(iso, paintTargetRef.current)
          }
        },

        onPanResponderMove: (evt) => {
          if (!metrics) return
          const { locationX, locationY } = evt.nativeEvent
          const iso = hitTestIso(locationX, locationY, metrics, slotMatrix)
          if (!iso) return

          if (!paintTargetRef.current) {
            const cur = effectiveDayStateMap(daysRef.current, iso, defaultMode)
            paintTargetRef.current = nextCellState(cur)
            if (!visitedRef.current.has(iso)) {
              visitedRef.current.add(iso)
              onPaintDay(iso, paintTargetRef.current)
            }
            return
          }

          if (!visitedRef.current.has(iso)) {
            visitedRef.current.add(iso)
            onPaintDay(iso, paintTargetRef.current)
          }
        },
        onPanResponderRelease: () => {
          visitedRef.current.clear()
          paintTargetRef.current = null
        },
        onPanResponderTerminate: () => {
          visitedRef.current.clear()
          paintTargetRef.current = null
        },
      }),
    [metrics, slotMatrix, onPaintDay, defaultMode]
  )

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
          const dayNum = parseInt(iso.slice(8, 10), 10)
          return (
            <Pressable
              key={iso}
              accessibilityRole="button"
              accessibilityLabel={`Day ${dayNum}`}
              onPress={() =>
                onPaintDay(iso, nextCellState(effectiveDayStateMap(days, iso, defaultMode)))
              }
              style={({ pressed }) => [
                styles.dayCell,
                st === 'off' && styles.cellOff,
                st === 'available' && styles.cellAvailable,
                st === 'booked' && styles.cellBooked,
                isToday && styles.cellTodayRing,
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
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout
          if (width <= 0 || height <= 0) return
          const numRows = slotMatrix.length
          if (numRows < 1) return
          const rowH = (height - Math.max(0, numRows - 1) * CELL_GAP) / numRows
          const cellW = (width - 6 * CELL_GAP) / 7
          setMetrics({ cellW, rowH, numRows })
        }}
        {...panResponder.panHandlers}
      >
        {rows}
      </View>
    </View>
  )
}

export default function AvailabilityScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const cardGutter = 12
  const pageWidth = Math.max(280, windowWidth - cardGutter * 2)
  const scrollRef = useRef<ScrollView>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [days, setDays] = useState<Record<string, CellState>>({})
  const [defaultMode, setDefaultMode] = useState<CalendarDefaultMode>('available')
  const [notes, setNotes] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1, 12, 0, 0, 0)
  })

  const todayISO = toISODateLocal(new Date())

  const load = useCallback(async () => {
    setLoadError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role, availability_calendar')
      .eq('id', user.id)
      .single()

    if (error) {
      setLoadError(error.message)
      setLoading(false)
      return
    }

    setRole(profile?.role ?? null)
    if (isFreelancerProfile(profile?.role)) {
      const parsed = parseAvailabilityCalendar(profile?.availability_calendar)
      setDays(parsed.days)
      setNotes(parsed.notes ?? '')
      setDefaultMode(parsed.version === 3 ? 'available' : 'off')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ x: pageWidth, animated: false })
  }, [cursor, pageWidth])

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x
    const page = Math.round(x / pageWidth)
    if (page === 0) {
      setCursor((c) => addMonths(c, -1))
    } else if (page === 2) {
      setCursor((c) => addMonths(c, 1))
    }
  }

  const shiftMonth = useCallback((delta: number) => {
    setCursor((c) => addMonths(c, delta))
  }, [])

  const paintDay = useCallback((iso: string, target: CellState) => {
    setDays((prev) => {
      const next = { ...prev }
      if (target === defaultMode) delete next[iso]
      else next[iso] = target
      return next
    })
  }, [defaultMode])

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
      { text: 'OK', onPress: () => router.replace('/(tabs)/dashboard') },
    ])
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (!isFreelancerProfile(role)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.replace('/(tabs)/dashboard')}
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

  const bottomPad = TAB_BAR_HEIGHT + insets.bottom + 24
  const prev = addMonths(cursor, -1)
  const next = addMonths(cursor, 1)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.replace('/(tabs)/dashboard')}
            hitSlop={12}
          >
            <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.backLabel}>Dashboard</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.kicker}>AVAILABILITY</Text>
          <Text style={styles.title}>Set it once.</Text>
          <Text style={styles.titleAccent}>Everyone sees it.</Text>
          <Text style={styles.subtitle}>
            Change month: arrows next to the month name, or swipe horizontally on the title / weekday row. Days: tap
            to cycle free → busy → blocked; drag horizontally to paint the same state.
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

          <View style={styles.swipeHint}>
            <ChevronLeft size={14} color="rgba(255,255,255,0.25)" strokeWidth={ICON_STROKE} />
            <Text style={styles.swipeHintText}>Change month</Text>
            <ChevronRight size={14} color="rgba(255,255,255,0.25)" strokeWidth={ICON_STROKE} />
          </View>

          <View style={[styles.calendarCard, { marginHorizontal: cardGutter }]}>
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              nestedScrollEnabled
              directionalLockEnabled={Platform.OS === 'ios'}
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              onMomentumScrollEnd={onMomentumScrollEnd}
              contentContainerStyle={{ width: pageWidth * 3 }}
            >
              <MonthPage
                pageWidth={pageWidth}
                year={prev.getFullYear()}
                monthIndex={prev.getMonth()}
                days={days}
                defaultMode={defaultMode}
                todayISO={todayISO}
                onPaintDay={paintDay}
                onShiftMonth={shiftMonth}
              />
              <MonthPage
                pageWidth={pageWidth}
                year={cursor.getFullYear()}
                monthIndex={cursor.getMonth()}
                days={days}
                defaultMode={defaultMode}
                todayISO={todayISO}
                onPaintDay={paintDay}
                onShiftMonth={shiftMonth}
              />
              <MonthPage
                pageWidth={pageWidth}
                year={next.getFullYear()}
                monthIndex={next.getMonth()}
                days={days}
                defaultMode={defaultMode}
                todayISO={todayISO}
                onPaintDay={paintDay}
                onShiftMonth={shiftMonth}
              />
            </ScrollView>

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
        </ScrollView>
      </KeyboardAvoidingView>
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
  swipeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  swipeHintText: { fontSize: 12, color: 'rgba(255,255,255,0.28)' },
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
