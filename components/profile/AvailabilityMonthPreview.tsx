import { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { AvailabilityCalendarPayload } from '@/lib/availabilityCalendar'
import { getDayState, toISODateLocal } from '@/lib/availabilityCalendar'
import type { CellState } from '@/lib/availabilityCalendar'

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

type Props = {
  calendar: AvailabilityCalendarPayload
  /** Month to display (year + month used; day ignored) */
  anchor: Date
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

export function AvailabilityMonthPreview({ calendar, anchor }: Props) {
  const { rows, monthLabel, availableCount, bookedCount } = useMemo(() => {
    const start = startOfMonth(anchor)
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
  }, [calendar.days, anchor])

  const hasAny =
    availableCount > 0 ||
    bookedCount > 0 ||
    (calendar.notes && calendar.notes.trim().length > 0) ||
    Object.keys(calendar.days).length > 0

  if (!hasAny) return null

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Availability</Text>
      <Text style={styles.sub}>
        {availableCount > 0
          ? `${availableCount} day${availableCount === 1 ? '' : 's'} free`
          : bookedCount > 0
            ? 'Calendar'
            : 'Availability'}
        {bookedCount > 0 ? ` · ${bookedCount} booked` : ''}
      </Text>
      <Text style={styles.month}>{monthLabel}</Text>
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
            return (
              <View key={cell.iso ?? ci} style={styles.weekCell}>
                <View
                  style={[
                    styles.dayBox,
                    st === 'available' && styles.dayAvail,
                    st === 'booked' && styles.dayBooked,
                  ]}
                >
                  <Text style={[styles.cellNum, st === 'available' && styles.cellNumOn]}>{cell.day}</Text>
                </View>
              </View>
            )
          })}
        </View>
      ))}
      {calendar.notes?.trim() ? <Text style={styles.notes}>{calendar.notes.trim()}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 22 },
  title: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.5,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  sub: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 12 },
  month: { fontSize: 14, fontWeight: '800', color: '#fff', marginBottom: 10 },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  weekLbl: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.28)',
  },
  dayBox: {
    width: '100%',
    minHeight: 32,
    maxWidth: 44,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  dayAvail: { backgroundColor: 'rgba(34,197,94,0.22)' },
  dayBooked: { backgroundColor: 'rgba(239,68,68,0.2)' },
  cellNum: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: '600' },
  cellNumOn: { color: 'rgba(134,239,172,0.95)' },
  notes: { marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 17 },
})
