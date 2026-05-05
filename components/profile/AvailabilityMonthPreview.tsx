import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Pressable,
  type LayoutChangeEvent,
} from 'react-native'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import type { AvailabilityCalendarPayload } from '@/lib/availabilityCalendar'
import { displayCellState, toISODateLocal } from '@/lib/availabilityCalendar'
import type { CellState } from '@/lib/availabilityCalendar'
import { ICON_STROKE } from '@/lib/iconTheme'
import { buildMonthSlotMatrix } from '@/lib/calendarMonth'
import { isIsoBookable } from '@/lib/availabilityBookingSelection'

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const
const CELL_GAP = 4
const PAINT_MOVE_SLOP = 10

type GridMetrics = { cellW: number; rowH: number; numRows: number }

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
          return slotMatrix[ri]?.[ci] ?? null
        }
        xRem -= cellW + CELL_GAP
      }
      return null
    }
    yRem -= rowH + CELL_GAP
  }
  return null
}

type Props = {
  calendar: AvailabilityCalendarPayload
  /** Initial month to display (year + month used; day ignored) */
  anchor: Date
  /** Company-only: select open days (tap or drag) then open booking modal. */
  interactive?: boolean
  /** Public freelancer profile: always show the calendar block (empty state when nothing set). */
  alwaysShow?: boolean
  /** Optional: ISO dates blocked by accepted jobs (shown as busy). */
  jobBookedIso?: ReadonlySet<string>
  /** Highlight after booking modal opened (same days stay selected). */
  committedBookingIsos?: ReadonlySet<string>
  /** Fires when user finishes a tap or drag on bookable days (non-empty set). */
  onCommitBookingSelection?: (isos: Set<string>) => void
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0)
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function mondayIndex(d: Date) {
  const dow = d.getDay()
  return dow === 0 ? 6 : dow - 1
}

export function AvailabilityMonthPreview({
  calendar,
  anchor,
  interactive = false,
  alwaysShow = false,
  jobBookedIso,
  committedBookingIsos,
  onCommitBookingSelection,
}: Props) {
  const [viewDate, setViewDate] = useState(() => startOfMonth(anchor))
  const [dragHighlight, setDragHighlight] = useState<Set<string>>(() => new Set())
  const [metrics, setMetrics] = useState<GridMetrics | null>(null)

  const slotMatrix = useMemo(
    () => buildMonthSlotMatrix(viewDate.getFullYear(), viewDate.getMonth()),
    [viewDate]
  )

  const calendarRef = useRef(calendar)
  calendarRef.current = calendar
  const jobBookedRef = useRef(jobBookedIso)
  jobBookedRef.current = jobBookedIso

  const visitedRef = useRef(new Set<string>())
  const dragActiveRef = useRef(false)
  const suppressTapRef = useRef(false)
  const isPaintingRef = useRef(false)

  useEffect(() => {
    setMetrics(null)
    setDragHighlight(new Set())
  }, [viewDate])

  const todayIso = useMemo(() => toISODateLocal(new Date()), [])

  const canBook = useCallback(
    (iso: string | null) =>
      Boolean(
        iso &&
          isIsoBookable(calendarRef.current, iso, jobBookedRef.current ?? undefined)
      ),
    []
  )

  const addVisited = useCallback((iso: string | null) => {
    if (!iso || !canBook(iso)) return
    visitedRef.current.add(iso)
    setDragHighlight(new Set(visitedRef.current))
  }, [canBook])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () =>
          Boolean(interactive && onCommitBookingSelection),
        onStartShouldSetPanResponderCapture: () =>
          Boolean(interactive && onCommitBookingSelection),
        onMoveShouldSetPanResponder: (_, gs) => {
          if (!interactive || !onCommitBookingSelection) return false
          const ax = Math.abs(gs.dx)
          const ay = Math.abs(gs.dy)
          if (ax < PAINT_MOVE_SLOP && ay < PAINT_MOVE_SLOP) return false
          return true
        },
        onMoveShouldSetPanResponderCapture: (_, gs) => {
          if (!interactive || !onCommitBookingSelection) return false
          const ax = Math.abs(gs.dx)
          const ay = Math.abs(gs.dy)
          return ax >= PAINT_MOVE_SLOP || ay >= PAINT_MOVE_SLOP
        },
        // Keep drag ownership while painting; avoid losing the gesture to parent scrollviews.
        onPanResponderTerminationRequest: () => !isPaintingRef.current,
        onPanResponderGrant: (evt) => {
          if (!metrics || !interactive || !onCommitBookingSelection) return
          isPaintingRef.current = true
          visitedRef.current.clear()
          dragActiveRef.current = false
          const { locationX, locationY } = evt.nativeEvent
          const iso = hitTestIso(locationX, locationY, metrics, slotMatrix)
          addVisited(iso)
        },
        onPanResponderMove: (evt) => {
          if (!metrics || !interactive || !onCommitBookingSelection) return
          dragActiveRef.current = true
          const { locationX, locationY } = evt.nativeEvent
          const iso = hitTestIso(locationX, locationY, metrics, slotMatrix)
          addVisited(iso)
        },
        onPanResponderRelease: () => {
          if (!interactive || !onCommitBookingSelection) return
          isPaintingRef.current = false
          const set = new Set(visitedRef.current)
          visitedRef.current.clear()
          setDragHighlight(new Set())
          if (set.size > 0) {
            if (dragActiveRef.current) {
              suppressTapRef.current = true
              setTimeout(() => {
                suppressTapRef.current = false
              }, 450)
            }
            onCommitBookingSelection(set)
          }
          dragActiveRef.current = false
        },
        onPanResponderTerminate: () => {
          isPaintingRef.current = false
          visitedRef.current.clear()
          setDragHighlight(new Set())
          dragActiveRef.current = false
        },
      }),
    [addVisited, interactive, metrics, onCommitBookingSelection, slotMatrix]
  )

  const onGridLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    if (width <= 0 || height <= 0) return
    const numRows = slotMatrix.length
    if (numRows < 1) return
    const rowH = (height - Math.max(0, numRows - 1) * CELL_GAP) / numRows
    const cellW = (width - 6 * CELL_GAP) / 7
    setMetrics({ cellW, rowH, numRows })
  }

  const { rows, monthLabel, availableCount, bookedCount } = useMemo(() => {
    const start = viewDate
    const y = start.getFullYear()
    const m = start.getMonth()
    const dim = daysInMonth(y, m)
    const pad = mondayIndex(start)
    const flat: { day: number | null; iso: string | null; state: CellState | 'empty' }[] = []
    for (let i = 0; i < pad; i++) {
      flat.push({ day: null, iso: null, state: 'empty' })
    }
    let av = 0
    let bk = 0
    const bookedOpts = jobBookedIso ? { jobBookedIso } : undefined
    for (let day = 1; day <= dim; day++) {
      const cellDate = new Date(y, m, day, 12, 0, 0, 0)
      const iso = toISODateLocal(cellDate)
      const state = displayCellState(calendar, iso, bookedOpts)
      if (state === 'available') av += 1
      if (state === 'booked') bk += 1
      flat.push({ day, iso, state })
    }
    while (flat.length % 7 !== 0) {
      flat.push({ day: null, iso: null, state: 'empty' })
    }
    const rowChunks: typeof flat[] = []
    for (let i = 0; i < flat.length; i += 7) {
      rowChunks.push(flat.slice(i, i + 7))
    }
    const monthLabel = start.toLocaleString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
    return { rows: rowChunks, monthLabel, availableCount: av, bookedCount: bk }
  }, [calendar, jobBookedIso, viewDate])

  const hasAny =
    availableCount > 0 ||
    bookedCount > 0 ||
    (calendar.notes && calendar.notes.trim().length > 0) ||
    Object.keys(calendar.days).length > 0 ||
    (jobBookedIso && jobBookedIso.size > 0) ||
    calendar.version === 3

  const showBlock = hasAny || interactive || alwaysShow

  const shiftMonth = (delta: number) => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1, 12, 0, 0, 0))
  }

  const mergedHighlight = useMemo(() => {
    const out = new Set<string>()
    committedBookingIsos?.forEach((x) => out.add(x))
    dragHighlight.forEach((x) => out.add(x))
    return out
  }, [committedBookingIsos, dragHighlight])

  if (!showBlock) return null

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.title}>Availability</Text>
        <Text style={styles.headHint} numberOfLines={5}>
          {interactive
            ? calendar.version === 3
              ? availableCount > 0
                ? `Tap an open day, or drag across open days to select several — then book. Grey = blocked, red = busy.`
                : 'No open days this month (all blocked or busy).'
              : !hasAny
                ? 'No availability published yet. Once they add free days, tap green days to invite.'
                : availableCount > 0
                  ? `Tap a free day — ${availableCount} day${availableCount === 1 ? '' : 's'} marked free`
                  : 'No free days this month'
            : calendar.version === 3
              ? availableCount > 0
                ? `${availableCount} open day${availableCount === 1 ? '' : 's'} this month unless marked busy/off.`
                : 'No open days this month.'
              : !hasAny
                ? 'No availability shared yet.'
                : availableCount > 0
                  ? `${availableCount} day${availableCount === 1 ? '' : 's'} free`
                  : 'No free days this month'}
        </Text>
      </View>
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={() => shiftMonth(-1)} hitSlop={12} accessibilityLabel="Previous month">
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
        <Text style={styles.month}>{monthLabel}</Text>
        <TouchableOpacity onPress={() => shiftMonth(1)} hitSlop={12} accessibilityLabel="Next month">
          <ChevronRight size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
      </View>
      <View style={styles.weekRow}>
        {WEEK.map((w, i) => (
          <View key={`${w}-${i}`} style={styles.weekCell}>
            <Text style={styles.weekLbl}>{w}</Text>
          </View>
        ))}
      </View>

      <View style={styles.gridTouchLayer} onLayout={onGridLayout} {...(interactive ? panResponder.panHandlers : {})}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.weekRow}>
            {row.map((cell, ci) => {
              if (cell.state === 'empty' || cell.day == null || !cell.iso) {
                return <View key={ci} style={styles.weekCell} />
              }
              const st = cell.state
              const iso = cell.iso
              const isToday = iso === todayIso
              const isSel = mergedHighlight.has(iso)
              const canTap = interactive && st === 'available' && onCommitBookingSelection
              const dayBox = (
                <View
                  style={[
                    styles.dayBox,
                    st === 'available' && styles.dayAvail,
                    st === 'booked' && styles.dayBooked,
                    st === 'off' && styles.dayOff,
                    isSel && styles.daySelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.cellNum,
                      st === 'available' && styles.cellNumAvail,
                      st === 'booked' && styles.cellNumBooked,
                      st === 'off' && styles.cellNumOff,
                    ]}
                  >
                    {cell.day}
                  </Text>
                </View>
              )
              return (
                <View key={iso} style={styles.weekCell}>
                  {canTap ? (
                    <Pressable
                      style={styles.dayWrap}
                      onPress={() => {
                        if (suppressTapRef.current) return
                        onCommitBookingSelection?.(new Set([iso]))
                      }}
                      accessibilityLabel={`Select ${iso} for booking`}
                    >
                      {isToday ? <View style={styles.todayDot} /> : null}
                      {dayBox}
                    </Pressable>
                  ) : (
                    <View style={styles.dayWrap}>
                      {isToday ? <View style={styles.todayDot} /> : null}
                      {dayBox}
                    </View>
                  )}
                </View>
              )
            })}
          </View>
        ))}
      </View>

      <View style={styles.legend}>
        <LegendDot color="rgba(34,197,94,0.85)" label="Available" />
        <LegendDot color="rgba(239,68,68,0.85)" label="Busy" />
        <LegendDot color="rgba(255,255,255,0.2)" label="Off" />
        <LegendDot color="#FFDC00" label="Today" small />
      </View>
      {calendar.notes?.trim() ? <Text style={styles.notes}>{calendar.notes.trim()}</Text> : null}
    </View>
  )
}

function LegendDot({ color, label, small }: { color: string; label: string; small?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }, small && styles.legendDotSmall]} />
      <Text style={styles.legendLbl}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 22 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  headHint: { flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.32)', textAlign: 'right' },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  month: { fontSize: 14, fontWeight: '800', color: '#fff', flex: 1, textAlign: 'center' },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  gridTouchLayer: { marginBottom: 0 },
  weekLbl: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.28)',
  },
  dayWrap: {
    width: '100%',
    maxWidth: 44,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  todayDot: {
    position: 'absolute',
    top: 0,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFDC00',
    zIndex: 2,
  },
  dayBox: {
    width: '100%',
    minHeight: 32,
    maxWidth: 44,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  dayAvail: { backgroundColor: 'rgba(34,197,94,0.18)', borderColor: 'rgba(34,197,94,0.45)' },
  dayBooked: { backgroundColor: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.4)' },
  dayOff: { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.06)' },
  daySelected: {
    borderColor: '#FFDC00',
    borderWidth: 2,
  },
  cellNum: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: '600' },
  cellNumAvail: { color: 'rgba(134,239,172,0.95)' },
  cellNumBooked: { color: 'rgba(252,165,165,0.95)' },
  cellNumOff: { color: 'rgba(255,255,255,0.35)' },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 14,
    alignItems: 'center',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendDotSmall: { width: 8, height: 8, borderRadius: 4 },
  legendLbl: { fontSize: 10, color: 'rgba(255,255,255,0.38)', fontWeight: '600' },
  notes: { marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 17 },
})
