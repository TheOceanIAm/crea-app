import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
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
  const [selectedIsos, setSelectedIsos] = useState<Set<string>>(() => new Set())
  const [selectionMode, setSelectionMode] = useState<'tap' | 'range'>('tap')
  const [rangeStartIso, setRangeStartIso] = useState<string | null>(null)

  const slotMatrix = useMemo(
    () => buildMonthSlotMatrix(viewDate.getFullYear(), viewDate.getMonth()),
    [viewDate]
  )

  const calendarRef = useRef(calendar)
  calendarRef.current = calendar
  const jobBookedRef = useRef(jobBookedIso)
  jobBookedRef.current = jobBookedIso

  useEffect(() => {
    setSelectedIsos(new Set())
    setRangeStartIso(null)
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

  const onToggleTapDay = useCallback((iso: string) => {
    if (!canBook(iso)) return
    setSelectedIsos((prev) => {
      const next = new Set(prev)
      if (next.has(iso)) next.delete(iso)
      else next.add(iso)
      return next
    })
  }, [canBook])

  const onRangeDay = useCallback((iso: string) => {
    if (!canBook(iso)) return
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
      const dIso = toISODateLocal(cur)
      if (canBook(dIso)) next.add(dIso)
      cur.setDate(cur.getDate() + 1)
    }
    setSelectedIsos(next)
    setRangeStartIso(null)
  }, [canBook, rangeStartIso])

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
    selectedIsos.forEach((x) => out.add(x))
    return out
  }, [committedBookingIsos, selectedIsos])

  if (!showBlock) return null

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.title}>Availability</Text>
        <Text style={styles.headHint} numberOfLines={5}>
          {interactive
            ? calendar.version === 3
              ? availableCount > 0
                ? `Tap for multiple days.`
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
      {interactive ? (
        <View style={styles.selectModeRow}>
          <TouchableOpacity
            style={[styles.selectModeChip, selectionMode === 'tap' && styles.selectModeChipOn]}
            onPress={() => {
              setSelectionMode('tap')
              setRangeStartIso(null)
            }}
          >
            <Text style={[styles.selectModeText, selectionMode === 'tap' && styles.selectModeTextOn]}>
              Tap
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.selectModeChip, selectionMode === 'range' && styles.selectModeChipOn]}
            onPress={() => {
              setSelectionMode('range')
              setRangeStartIso(null)
            }}
          >
            <Text style={[styles.selectModeText, selectionMode === 'range' && styles.selectModeTextOn]}>
              Range
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.selectModeClear}
            onPress={() => {
              setSelectedIsos(new Set())
              setRangeStartIso(null)
            }}
          >
            <Text style={styles.selectModeClearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.weekRow}>
        {WEEK.map((w, i) => (
          <View key={`${w}-${i}`} style={styles.weekCell}>
            <Text style={styles.weekLbl}>{w}</Text>
          </View>
        ))}
      </View>

      <View style={styles.gridTouchLayer}>
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
                        if (selectionMode === 'range') onRangeDay(iso)
                        else onToggleTapDay(iso)
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
      {interactive ? (
        <View style={styles.commitRow}>
          <Text style={styles.commitInfo}>
            {selectedIsos.size > 0
              ? `${selectedIsos.size} day${selectedIsos.size === 1 ? '' : 's'} selected`
              : rangeStartIso
                ? `Range start: ${rangeStartIso}`
                : 'No days selected'}
          </Text>
          <TouchableOpacity
            style={[styles.commitBtn, selectedIsos.size === 0 && styles.commitBtnDim]}
            disabled={selectedIsos.size === 0}
            onPress={() => onCommitBookingSelection?.(new Set(selectedIsos))}
          >
            <Text style={styles.commitBtnText}>Book selected</Text>
          </TouchableOpacity>
        </View>
      ) : null}
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
  selectModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  selectModeChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#111',
  },
  selectModeChipOn: {
    borderColor: '#FFDC00',
    backgroundColor: 'rgba(255,220,0,0.12)',
  },
  selectModeText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  selectModeTextOn: { color: '#FFDC00' },
  selectModeClear: { marginLeft: 'auto', paddingVertical: 6, paddingHorizontal: 10 },
  selectModeClearText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  commitRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  commitInfo: { flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  commitBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  commitBtnDim: { opacity: 0.45 },
  commitBtnText: { fontSize: 11, fontWeight: '800', color: '#0a0a0a' },
  notes: { marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 17 },
})
