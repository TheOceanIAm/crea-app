import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { formatProductionWindowSummary } from '@/lib/projectProductionWindow'
import { buildMonthSlotMatrix } from '@/lib/calendarMonth'
import { toISODateLocal } from '@/lib/availabilityCalendar'
import { ICON_STROKE } from '@/lib/iconTheme'

type Props = {
  scheduleStart: string
  scheduleEnd: string
  onChangeStart: (v: string) => void
  onChangeEnd: (v: string) => void
  onSave: () => void | Promise<void>
  onClear: () => void | Promise<void>
  saving: boolean
  /** Starter freelancer plan — calendar blocking disabled */
  lockedByPlan: boolean
  /** Client company only — crew sees read-only summary */
  readOnly: boolean
}

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0)
}

function inclusiveRangeKeys(a: string, b: string): Set<string> {
  const da = new Date(`${a}T12:00:00`)
  const db = new Date(`${b}T12:00:00`)
  const [from, to] = da <= db ? [da, db] : [db, da]
  const out = new Set<string>()
  const cur = new Date(from)
  while (cur <= to) {
    out.add(toISODateLocal(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function pushRangeToParent(
  onChangeStart: (v: string) => void,
  onChangeEnd: (v: string) => void,
  keys: Set<string>
) {
  if (keys.size === 0) {
    onChangeStart('')
    onChangeEnd('')
    return
  }
  const sorted = [...keys].sort()
  onChangeStart(sorted[0]!)
  onChangeEnd(sorted[sorted.length - 1]!)
}

export function ProjectOverviewProductionWindow({
  scheduleStart,
  scheduleEnd,
  onChangeStart,
  onChangeEnd,
  onSave,
  onClear,
  saving,
  lockedByPlan,
  readOnly,
}: Props) {
  const summary = formatProductionWindowSummary(scheduleStart, scheduleEnd)
  const canEdit = !readOnly && !lockedByPlan
  const hasBothSaved =
    /^\d{4}-\d{2}-\d{2}$/.test(scheduleStart.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(scheduleEnd.trim())

  const todayIso = useMemo(() => toISODateLocal(new Date()), [])

  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()))
  const [selectionMode, setSelectionMode] = useState<'tap' | 'range'>('range')
  const [rangeAnchorIso, setRangeAnchorIso] = useState<string | null>(null)
  const [tapSelected, setTapSelected] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const a = scheduleStart.trim().slice(0, 10)
    const b = scheduleEnd.trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b)) {
      setTapSelected(inclusiveRangeKeys(a, b))
    } else {
      setTapSelected(new Set())
    }
  }, [scheduleStart, scheduleEnd])

  useEffect(() => {
    const a = scheduleStart.trim().slice(0, 10)
    const p = /^\d{4}-\d{2}-\d{2}$/.test(a) ? parseYmdToDate(a) : null
    if (p) setViewDate(startOfMonth(p))
  }, [scheduleStart])

  const slotMatrix = useMemo(
    () => buildMonthSlotMatrix(viewDate.getFullYear(), viewDate.getMonth()),
    [viewDate]
  )

  const committedHighlight = useMemo(() => {
    const a = scheduleStart.trim().slice(0, 10)
    const b = scheduleEnd.trim().slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b)) return inclusiveRangeKeys(a, b)
    return new Set<string>()
  }, [scheduleStart, scheduleEnd])

  const highlightMerged = useMemo(() => {
    const out = new Set<string>()
    committedHighlight.forEach((x) => out.add(x))
    tapSelected.forEach((x) => out.add(x))
    return out
  }, [committedHighlight, tapSelected])

  const canSelect = useCallback((iso: string | null) => Boolean(iso && iso >= todayIso), [todayIso])

  const onToggleTapDay = useCallback(
    (iso: string) => {
      if (!canSelect(iso)) return
      setTapSelected((prev) => {
        const next = new Set(prev)
        if (next.has(iso)) next.delete(iso)
        else next.add(iso)
        pushRangeToParent(onChangeStart, onChangeEnd, next)
        return next
      })
      setRangeAnchorIso(null)
    },
    [canSelect, onChangeEnd, onChangeStart]
  )

  const onRangeDay = useCallback(
    (iso: string) => {
      if (!canSelect(iso)) return
      if (!rangeAnchorIso) {
        setRangeAnchorIso(iso)
        setTapSelected(new Set([iso]))
        onChangeStart(iso)
        onChangeEnd(iso)
        return
      }
      const keys = inclusiveRangeKeys(rangeAnchorIso, iso)
      const filtered = new Set<string>()
      keys.forEach((k) => {
        if (canSelect(k)) filtered.add(k)
      })
      setTapSelected(filtered)
      pushRangeToParent(onChangeStart, onChangeEnd, filtered)
      setRangeAnchorIso(null)
    },
    [canSelect, onChangeEnd, onChangeStart, rangeAnchorIso]
  )

  const shiftMonth = (delta: number) => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1, 12, 0, 0, 0))
    setRangeAnchorIso(null)
  }

  const monthLabel = viewDate.toLocaleString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Production window</Text>
      {lockedByPlan ? (
        <Text style={styles.lockedHint}>Upgrade to Pro to sync busy dates to the freelancer&apos;s public profile.</Text>
      ) : null}
      {summary ? (
        <View style={styles.summaryPill}>
          <Text style={styles.summaryText}>{summary}</Text>
        </View>
      ) : (
        <Text style={styles.placeholder}>No dates set yet.</Text>
      )}
      {canEdit ? (
        <>
          <Text style={styles.calHint}>
            Same idea as the freelancer public calendar: use Range for a contiguous block (tap start, then end) or Tap to add /
            remove individual days. Saving stores the span from earliest to latest selected day (gaps are included).
          </Text>
          <View style={styles.monthNav}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} hitSlop={12} accessibilityLabel="Previous month">
              <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
            <Text style={styles.month}>{monthLabel}</Text>
            <TouchableOpacity onPress={() => shiftMonth(1)} hitSlop={12} accessibilityLabel="Next month">
              <ChevronRight size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          </View>
          <View style={styles.selectModeRow}>
            <TouchableOpacity
              style={[styles.selectModeChip, selectionMode === 'range' && styles.selectModeChipOn]}
              onPress={() => {
                setSelectionMode('range')
                setRangeAnchorIso(null)
              }}
            >
              <Text style={[styles.selectModeText, selectionMode === 'range' && styles.selectModeTextOn]}>Range</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.selectModeChip, selectionMode === 'tap' && styles.selectModeChipOn]}
              onPress={() => {
                setSelectionMode('tap')
                setRangeAnchorIso(null)
              }}
            >
              <Text style={[styles.selectModeText, selectionMode === 'tap' && styles.selectModeTextOn]}>Tap</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.weekRow}>
            {WEEK.map((w, i) => (
              <View key={`${w}-${i}`} style={styles.weekCell}>
                <Text style={styles.weekLbl}>{w}</Text>
              </View>
            ))}
          </View>
          {slotMatrix.map((row, ri) => (
            <View key={ri} style={styles.weekRow}>
              {row.map((iso, ci) => {
                if (!iso) {
                  return <View key={`e-${ci}`} style={styles.weekCell} />
                }
                const dayNum = Number(iso.slice(8, 10))
                const isPast = iso < todayIso
                const isSel = highlightMerged.has(iso)
                const isToday = iso === todayIso
                return (
                  <View key={iso} style={styles.weekCell}>
                    <Pressable
                      style={styles.dayWrap}
                      disabled={isPast}
                      onPress={() => {
                        if (selectionMode === 'range') onRangeDay(iso)
                        else onToggleTapDay(iso)
                      }}
                      accessibilityLabel={`Select production day ${iso}`}
                    >
                      {isToday ? <View style={styles.todayDot} /> : null}
                      <View
                        style={[
                          styles.dayBox,
                          !isPast && styles.daySelectable,
                          isPast && styles.dayPast,
                          isSel && styles.daySelected,
                        ]}
                      >
                        <Text style={[styles.cellNum, isPast && styles.cellNumPast, isSel && styles.cellNumSel]}>
                          {dayNum}
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                )
              })}
            </View>
          ))}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.btnDim]}
              onPress={() => void onSave()}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save production dates"
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
            {hasBothSaved ? (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => void onClear()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Clear production dates"
              >
                <Text style={styles.clearBtnText}>Clear dates</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </>
      ) : readOnly ? (
        <Text style={styles.readOnlyHint}>Only the hiring company can edit these dates.</Text>
      ) : null}
    </View>
  )
}

function parseYmdToDate(ymd: string): Date | null {
  const t = ymd.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const [y, mo, d] = t.split('-').map(Number)
  return new Date(y, mo - 1, d, 12, 0, 0, 0)
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 18,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  lockedHint: {
    fontSize: 11,
    color: '#FFDC00',
    marginBottom: 8,
    fontWeight: '700',
    lineHeight: 15,
  },
  summaryPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 10,
  },
  summaryText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  placeholder: { fontSize: 12, color: 'rgba(255,255,255,0.32)', marginBottom: 8 },
  calHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.38)',
    lineHeight: 15,
    marginBottom: 10,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  month: { fontSize: 14, fontWeight: '800', color: '#fff', flex: 1, textAlign: 'center' },
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
  daySelectable: {
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderColor: 'rgba(34,197,94,0.35)',
  },
  dayPast: {
    opacity: 0.35,
  },
  daySelected: {
    borderColor: '#FFDC00',
    borderWidth: 2,
    backgroundColor: 'rgba(255,220,0,0.14)',
  },
  cellNum: { fontSize: 11, color: 'rgba(134,239,172,0.95)', fontWeight: '600' },
  cellNumPast: { color: 'rgba(255,255,255,0.22)' },
  cellNumSel: { color: '#FFDC00' },
  actions: { gap: 8, marginTop: 12 },
  saveBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnDim: { opacity: 0.55 },
  saveBtnText: { fontSize: 13, fontWeight: '800', color: '#0a0a0a' },
  clearBtn: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  clearBtnText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  readOnlyHint: { fontSize: 11, color: 'rgba(255,255,255,0.32)', marginTop: 2 },
})
