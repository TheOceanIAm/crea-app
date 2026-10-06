import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { ChevronDown } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { supabase } from '@/lib/supabase'
import {
  timesheetPeopleFromMembers,
  visibleTimesheetDates,
  type CrewSpendMemberRow,
  type TimesheetHourEntry,
  type TimesheetPerson,
} from '@/lib/projectInternalBudget'

type StoredEntry = TimesheetHourEntry & { id: string }

function profileName(profiles: unknown): string {
  if (Array.isArray(profiles)) return profileName(profiles[0])
  if (profiles && typeof profiles === 'object' && 'name' in profiles) {
    const name = (profiles as { name?: string | null }).name
    return typeof name === 'string' ? name.trim() : ''
  }
  return ''
}

function parseHours(raw: string): number | null {
  const t = raw.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null
  return Math.round(n * 100) / 100
}

function formatSheetDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

function draftKey(personKey: string, date: string): string {
  return `${personKey}|${date}`
}

export function ProjectTimesheetPanel({
  projectId,
  scope,
  onEntriesChange,
}: {
  projectId: string
  scope: 'company' | 'self'
  onEntriesChange?: (entries: TimesheetHourEntry[]) => void
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [people, setPeople] = useState<TimesheetPerson[]>([])
  const [entries, setEntries] = useState<StoredEntry[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [added, setAdded] = useState<Record<string, string[]>>({})
  const [newDate, setNewDate] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [openPeople, setOpenPeople] = useState<Record<string, boolean>>({})

  const publish = useCallback(
    (next: StoredEntry[]) => {
      onEntriesChange?.(next.map(({ personKey, workDate, hours }) => ({ personKey, workDate, hours })))
    },
    [onEntriesChange]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const [membersRes, manualRes, sheetRes] = await Promise.all([
      supabase
        .from('project_members')
        .select('profile_id, member_role, booked_dates, scheduling_start_date, scheduling_end_date, profiles(name)')
        .eq('project_id', projectId),
      scope === 'company'
        ? supabase
            .from('project_manual_crew_readable')
            .select('id, name, member_role, booked_dates, scheduling_start_date, scheduling_end_date, claimed_profile_id')
            .eq('project_id', projectId)
            .is('claimed_profile_id', null)
        : Promise.resolve({ data: [] as unknown[], error: null }),
      supabase
        .from('project_timesheet_entries')
        .select('id, work_date, hours, profile_id, manual_crew_id')
        .eq('project_id', projectId),
    ])

    const loadError = membersRes.error || manualRes.error || sheetRes.error
    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    const registered = ((membersRes.data ?? []) as unknown[]).map((raw) => {
      const row = raw as {
        profile_id: string
        member_role: string | null
        booked_dates?: unknown
        scheduling_start_date?: string | null
        scheduling_end_date?: string | null
        profiles?: unknown
      }
      const spend: CrewSpendMemberRow = {
        profile_id: row.profile_id,
        member_role: (row.member_role ?? 'crew').trim() || 'crew',
        booked_dates: row.booked_dates,
        scheduling_start_date: row.scheduling_start_date,
        scheduling_end_date: row.scheduling_end_date,
        display_name: profileName(row.profiles) || null,
        profiles: { name: profileName(row.profiles) || null },
      }
      return spend
    })
    const manualRows = (manualRes.data ?? []) as Array<{
      id: string
      name: string | null
      member_role: string | null
      booked_dates?: unknown
      scheduling_start_date?: string | null
      scheduling_end_date?: string | null
    }>
    const manualSpend: CrewSpendMemberRow[] = manualRows.map((m) => ({
      profile_id: `manual:${m.id}`,
      member_role: (m.member_role ?? 'crew').trim() || 'crew',
      booked_dates: m.booked_dates,
      scheduling_start_date: m.scheduling_start_date,
      scheduling_end_date: m.scheduling_end_date,
      display_name: (m.name ?? '').trim() || 'Crew',
      profiles: null,
    }))
    let nextPeople = timesheetPeopleFromMembers([...registered, ...manualSpend])
    if (scope === 'self') {
      nextPeople = user ? nextPeople.filter((person) => person.profileId === user.id) : []
    }
    const nextEntries: StoredEntry[] = []
    for (const raw of sheetRes.data ?? []) {
      const row = raw as {
        id: string
        work_date: string
        hours: number | string
        profile_id: string | null
        manual_crew_id: string | null
      }
      const hours = typeof row.hours === 'number' ? row.hours : Number(row.hours)
      const personKey = row.profile_id ?? (row.manual_crew_id ? `manual:${row.manual_crew_id}` : '')
      if (!personKey || !(hours > 0)) continue
      nextEntries.push({
        id: row.id,
        personKey,
        workDate: String(row.work_date).slice(0, 10),
        hours,
      })
    }
    const nextDrafts: Record<string, string> = {}
    for (const entry of nextEntries) {
      nextDrafts[draftKey(entry.personKey, entry.workDate)] = String(entry.hours)
    }
    setPeople(nextPeople)
    setEntries(nextEntries)
    setDrafts(nextDrafts)
    publish(nextEntries)
    setLoading(false)
  }, [projectId, scope, publish])

  useEffect(() => {
    void load()
  }, [load])

  const saveHours = async (person: TimesheetPerson, date: string, raw: string) => {
    const key = draftKey(person.key, date)
    const hours = parseHours(raw)
    if (raw.trim() && hours == null) {
      setError('Enter hours between 0 and 24, or leave the field empty to clear the day.')
      return
    }
    setSavingKey(key)
    setError(null)
    const existing = entries.find((entry) => entry.personKey === person.key && entry.workDate === date)
    let next = entries
    if (hours == null) {
      if (existing) {
        const { error: deleteError } = await supabase.from('project_timesheet_entries').delete().eq('id', existing.id)
        if (deleteError) {
          setError(deleteError.message)
          setSavingKey(null)
          return
        }
        next = entries.filter((entry) => entry.id !== existing.id)
      }
    } else if (existing) {
      const { error: updateError } = await supabase
        .from('project_timesheet_entries')
        .update({ hours, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (updateError) {
        setError(updateError.message)
        setSavingKey(null)
        return
      }
      next = entries.map((entry) => (entry.id === existing.id ? { ...entry, hours } : entry))
    } else {
      const { data, error: insertError } = await supabase
        .from('project_timesheet_entries')
        .insert({
          project_id: projectId,
          work_date: date,
          hours,
          profile_id: person.profileId,
          manual_crew_id: person.manualCrewId,
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (insertError || !data) {
        setError(insertError?.message || 'Could not save hours')
        setSavingKey(null)
        return
      }
      next = [...entries, { id: (data as { id: string }).id, personKey: person.key, workDate: date, hours }]
    }
    setEntries(next)
    setDrafts((prev) => ({ ...prev, [key]: hours == null ? '' : String(hours) }))
    publish(next)
    setSavingKey(null)
  }

  const datesFor = useMemo(() => {
    return (person: TimesheetPerson) => {
      const dates = new Set(visibleTimesheetDates(person, entries))
      for (const date of added[person.key] ?? []) dates.add(date)
      return [...dates].sort()
    }
  }, [added, entries])

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  const loggedHours = Math.round(entries.reduce((sum, entry) => sum + entry.hours, 0) * 100) / 100

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.foldHeader}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.foldHeaderText}>
          <Text style={styles.cardTitle}>Timesheet</Text>
          <Text style={styles.foldAmount}>{loggedHours}h logged</Text>
        </View>
        <ChevronDown
          size={18}
          color="rgba(255,255,255,0.45)"
          strokeWidth={ICON_STROKE}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>
      {open ? (
      <View style={styles.foldBody}>
      <Text style={styles.muted}>
        {scope === 'self'
          ? 'Log the hours you worked. 10 hours counts as one day. Your company uses this on Budget → Current while the shoot is running.'
          : 'Optional. Logged hours replace that booked day in Current. A day with no hours stays on the booking. 10 hours = one day.'}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {people.length === 0 ? (
        <Text style={styles.muted}>
          {scope === 'self' ? 'You are not on the crew list for this project yet.' : 'No crew to log yet.'}
        </Text>
      ) : (
        people.map((person) => {
          const dates = datesFor(person)
          return (
            <View key={person.key} style={styles.person}>
              <TouchableOpacity
                style={styles.foldHeader}
                onPress={() => setOpenPeople((prev) => ({ ...prev, [person.key]: !(prev[person.key] ?? true) }))}
                accessibilityRole="button"
                accessibilityState={{ expanded: openPeople[person.key] ?? true }}
              >
                <Text style={[styles.name, styles.nameInHeader]}>{person.name}</Text>
                <ChevronDown
                  size={16}
                  color="rgba(255,255,255,0.45)"
                  strokeWidth={ICON_STROKE}
                  style={{ transform: [{ rotate: (openPeople[person.key] ?? true) ? '180deg' : '0deg' }] }}
                />
              </TouchableOpacity>
              {(openPeople[person.key] ?? true) ? (
              <View>
              {dates.length === 0 ? <Text style={styles.muted}>No booked days yet. Add a day to log hours.</Text> : null}
              {dates.map((date) => {
                const booked = person.bookedDates.find((slot) => slot.date === date)
                const key = draftKey(person.key, date)
                return (
                  <View key={date} style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.date}>{formatSheetDate(date)}</Text>
                      <Text style={styles.meta}>
                        {booked ? `Booked ${booked.units === 0.5 ? 'half day' : 'day'}` : 'Extra day'}
                      </Text>
                    </View>
                    <TextInput
                      style={styles.input}
                      value={drafts[key] ?? ''}
                      placeholder="Hours"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      keyboardType="decimal-pad"
                      editable={savingKey !== key}
                      onChangeText={(value) => setDrafts((prev) => ({ ...prev, [key]: value }))}
                      onEndEditing={() => void saveHours(person, date, drafts[key] ?? '')}
                    />
                  </View>
                )
              })}
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, styles.dateInput]}
                  value={newDate[person.key] ?? ''}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCapitalize="none"
                  onChangeText={(value) => setNewDate((prev) => ({ ...prev, [person.key]: value }))}
                />
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={() => {
                    const date = (newDate[person.key] ?? '').trim().slice(0, 10)
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                      setError('Use a date like 2026-10-06.')
                      return
                    }
                    setError(null)
                    setAdded((prev) => ({
                      ...prev,
                      [person.key]: [...new Set([...(prev[person.key] ?? []), date])],
                    }))
                    setNewDate((prev) => ({ ...prev, [person.key]: '' }))
                  }}
                >
                  <Text style={styles.addBtnText}>Add day</Text>
                </TouchableOpacity>
              </View>
              </View>
              ) : null}
            </View>
          )
        })
      )}
      </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  foldHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  foldHeaderText: { flex: 1, minWidth: 0 },
  foldAmount: { fontSize: 18, fontWeight: '800', color: '#FFDC00' },
  foldBody: { marginTop: 12 },
  nameInHeader: { flex: 1, marginBottom: 0 },
  muted: { fontSize: 12, color: 'rgba(255,255,255,0.38)', marginBottom: 8, lineHeight: 17 },
  error: { color: '#ff8b8b', fontSize: 12, marginBottom: 8 },
  person: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 12,
    marginTop: 4,
  },
  name: { color: '#fff', fontWeight: '700', fontSize: 15, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  rowText: { flex: 1, minWidth: 0 },
  date: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  meta: { color: 'rgba(255,255,255,0.35)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 },
  input: {
    width: 88,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    color: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  dateInput: { flex: 1, width: undefined },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  addBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addBtnText: { color: 'rgba(255,255,255,0.75)', fontWeight: '700', fontSize: 12 },
})
