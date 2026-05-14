import { useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { buildMonthSlotMatrix } from '@/lib/calendarMonth'
import { toISODateLocal } from '@/lib/availabilityCalendar'
import { ICON_STROKE } from '@/lib/iconTheme'
import type { BookedDateEntry } from '@/lib/memberBookedDates'

type Props = {
  productionWindowStart: string
  productionWindowEnd: string
  bookedSlots: BookedDateEntry[]
  /** Cycles each cell: off → full day → half day → off */
  onCycleIso: (iso: string) => void
  disabled?: boolean
  /** Parent shows summary — omit long instructional copy above the grid */
  hideInstructions?: boolean
}

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

export function CrewMemberBookedDaysCalendar({
  productionWindowStart,
  productionWindowEnd,
  bookedSlots,
  onCycleIso,
  disabled = false,
  hideInstructions = false,
}: Props) {
  const todayIso = useMemo(() => toISODateLocal(new Date()), [])

  const windowOk =
    /^\d{4}-\d{2}-\d{2}$/.test(productionWindowStart.trim()) &&
    /^\d{4}-\d{2}-\d{2}$/.test(productionWindowEnd.trim()) &&
    productionWindowEnd.trim().slice(0, 10) >= productionWindowStart.trim().slice(0, 10)

  const ws = productionWindowStart.trim().slice(0, 10)
  const we = productionWindowEnd.trim().slice(0, 10)

  const [viewDate, setViewDate] = useState(() => {
    const a = productionWindowStart.trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(a)) {
      const [y, mo, d] = a.split('-').map(Number)
      return new Date(y, mo - 1, d, 12, 0, 0, 0)
    }
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12, 0, 0, 0)
  })

  const slotMatrix = useMemo(
    () => buildMonthSlotMatrix(viewDate.getFullYear(), viewDate.getMonth()),
    [viewDate],
  )

  const unitsByIso = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of bookedSlots) {
      if (s.units > 0) m.set(s.date, s.units)
    }
    return m
  }, [bookedSlots])

  const monthLabel = viewDate.toLocaleString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()

  const shiftMonth = (delta: number) => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1, 12, 0, 0, 0))
  }

  const canTapCell = (iso: string | null) => {
    if (!iso || disabled || !windowOk) return false
    if (iso < todayIso) return false
    return iso >= ws && iso <= we
  }

  return (
    <View style={styles.wrap}>
      {!hideInstructions ? (
        !windowOk ? (
          <Text style={styles.warn}>
            Set the overall production window on Overview first — then tap shoot days here (within that range).
          </Text>
        ) : (
          <Text style={styles.hint}>
            Tap a day to cycle: off → full day → half day → off. Then save.
          </Text>
        )
      ) : null}
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
      <View style={!windowOk || disabled ? styles.dimmed : undefined}>
        {slotMatrix.map((row, ri) => (
          <View key={ri} style={styles.weekRow}>
            {row.map((iso, ci) => {
              if (!iso) return <View key={`e-${ci}`} style={styles.weekCell} />
              const dayNum = Number(iso.slice(8, 10))
              const tap = canTapCell(iso)
              const isPast = iso < todayIso
              const u = unitsByIso.get(iso) ?? 0
              const isFull = u >= 1
              const isHalf = u > 0 && u < 1
              const isToday = iso === todayIso
              const outside = windowOk && (iso < ws || iso > we)

              return (
                <View key={iso} style={styles.weekCell}>
                  <Pressable
                    style={styles.dayWrap}
                    disabled={!tap}
                    onPress={() => {
                      if (!tap) return
                      onCycleIso(iso)
                    }}
                    accessibilityLabel={`Cycle shoot day ${iso}`}
                  >
                    {isToday ? <View style={styles.todayDot} /> : null}
                    <View
                      style={[
                        styles.dayBox,
                        tap && styles.daySelectable,
                        (!tap || isPast || outside) && styles.dayMuted,
                        isFull && styles.daySelected,
                        isHalf && styles.dayHalf,
                      ]}
                    >
                      <Text
                        style={[
                          styles.cellNum,
                          (!tap || outside) && styles.cellNumMuted,
                          (isFull || isHalf) && styles.cellNumSel,
                        ]}
                      >
                        {dayNum}
                      </Text>
                      {isHalf ? (
                        <Text style={styles.halfBadge} accessibilityLabel="Half day">
                          ½
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                </View>
              )
            })}
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  warn: { fontSize: 11, color: '#fbbf24', lineHeight: 15, marginBottom: 8 },
  hint: { fontSize: 11, color: 'rgba(255,255,255,0.38)', lineHeight: 15, marginBottom: 10 },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  month: { fontSize: 13, fontWeight: '800', color: '#fff', flex: 1, textAlign: 'center' },
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
    position: 'relative',
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
  daySelectable: {
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderColor: 'rgba(34,197,94,0.35)',
  },
  dayMuted: {
    opacity: 0.35,
  },
  daySelected: {
    borderColor: '#FFDC00',
    borderWidth: 2,
    backgroundColor: 'rgba(255,220,0,0.14)',
  },
  dayHalf: {
    borderColor: 'rgba(255,220,0,0.65)',
    borderWidth: 2,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,220,0,0.07)',
  },
  halfBadge: {
    position: 'absolute',
    bottom: 1,
    fontSize: 8,
    fontWeight: '800',
    color: '#FFDC00',
  },
  cellNum: { fontSize: 11, color: 'rgba(134,239,172,0.95)', fontWeight: '600' },
  cellNumMuted: { color: 'rgba(255,255,255,0.22)' },
  cellNumSel: { color: '#FFDC00' },
  dimmed: { opacity: 0.45 },
})
