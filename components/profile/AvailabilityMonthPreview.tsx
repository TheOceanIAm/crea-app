import { useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import type { AvailabilityCalendarPayload } from '@/lib/availabilityCalendar'
import { getDayState, toISODateLocal } from '@/lib/availabilityCalendar'
import type { CellState } from '@/lib/availabilityCalendar'
import { ICON_STROKE } from '@/lib/iconTheme'

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

type Props = {
  calendar: AvailabilityCalendarPayload
  /** Initial month to display (year + month used; day ignored) */
  anchor: Date
  /** Company-only: tap a free (green) day — e.g. invite freelancer to a project. */
  interactive?: boolean
  /** Public freelancer profile: always show the calendar block (empty state when nothing set). */
  alwaysShow?: boolean
  onDayPress?: (iso: string) => void
  selectedIso?: string | null
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
  onDayPress,
  selectedIso,
}: Props) {
  const [viewDate, setViewDate] = useState(() => startOfMonth(anchor))

  const todayIso = useMemo(() => toISODateLocal(new Date()), [])

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
    for (let day = 1; day <= dim; day++) {
      const cellDate = new Date(y, m, day, 12, 0, 0, 0)
      const iso = toISODateLocal(cellDate)
      const state = getDayState(calendar.days, iso)
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
  }, [calendar.days, viewDate])

  const hasAny =
    availableCount > 0 ||
    bookedCount > 0 ||
    (calendar.notes && calendar.notes.trim().length > 0) ||
    Object.keys(calendar.days).length > 0

  /** Companies need the calendar (incl. empty) to invite; public profiles can force the block visible. */
  const showBlock = hasAny || interactive || alwaysShow

  if (!showBlock) return null

  const shiftMonth = (delta: number) => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1, 12, 0, 0, 0))
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.title}>Availability</Text>
        <Text style={styles.headHint} numberOfLines={3}>
          {interactive
            ? !hasAny
              ? 'No availability published yet. Once they add free days, tap green days to invite to a project.'
              : availableCount > 0
                ? `Tap a free day — ${availableCount} day${availableCount === 1 ? '' : 's'} marked free`
                : 'No free days this month'
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
      {rows.map((row, ri) => (
        <View key={ri} style={styles.weekRow}>
          {row.map((cell, ci) => {
            if (cell.state === 'empty' || cell.day == null) {
              return <View key={ci} style={styles.weekCell} />
            }
            const st = cell.state
            const isToday = cell.iso === todayIso
            const iso = cell.iso
            const isSel = Boolean(iso && selectedIso && iso === selectedIso)
            const canTap = interactive && st === 'available' && iso && onDayPress
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
              <View key={cell.iso ?? ci} style={styles.weekCell}>
                {canTap ? (
                  <TouchableOpacity
                    style={styles.dayWrap}
                    onPress={() => iso && onDayPress?.(iso)}
                    activeOpacity={0.75}
                    accessibilityLabel={`Invite for ${iso}`}
                  >
                    {isToday ? <View style={styles.todayDot} /> : null}
                    {dayBox}
                  </TouchableOpacity>
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
