import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { ChevronLeft, ChevronRight, Clock, MapPin, Plus, Users } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { ProductionWeatherSection } from '@/components/project/ProductionWeatherSection'
import { BriefAiFormattedOutput } from '@/components/project/BriefAiFormattedOutput'

type ShotStatus = 'open' | 'rolling' | 'done' | 'pick'

type ProductionShot = {
  id: string
  project_id: string
  shoot_date: string
  scene_nr: string
  description: string
  lens: string
  /** Set / room */
  location: string
  /** Shot size / intent (WS, MCU, …) */
  framing: string
  /** Mic / sound notes */
  audio_notes: string
  status: ShotStatus
  created_at: string
  updated_at: string
}

type CrewRow = {
  id: string
  profile_id: string
  member_role: string
  profiles: { name: string | null } | null
}

type CallOverride = { call_time?: string; location?: string }

type ProductionDayRow = {
  id: string
  project_id: string
  date: string
  wrap_time: string | null
  notes: string | null
  call_sheet: Record<string, CallOverride>
}

const STATUS_ORDER: ShotStatus[] = ['open', 'rolling', 'done', 'pick']

const STATUS_LABEL: Record<ShotStatus, string> = {
  open: 'Open',
  rolling: 'Rolling',
  done: 'Done',
  pick: 'Pick',
}

function todayLocalISODate(): string {
  const t = new Date()
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const d = String(t.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseIsoDateInput(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const d = new Date(`${t}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return t
}

function nextStatus(s: ShotStatus): ShotStatus {
  const i = STATUS_ORDER.indexOf(s)
  return STATUS_ORDER[(i + 1) % STATUS_ORDER.length]
}

function roleLabel(r: string) {
  if (r === 'company') return 'Client'
  if (r === 'lead') return 'Lead'
  return 'Crew'
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizeShotRow(raw: Record<string, unknown>): ProductionShot {
  return {
    id: String(raw.id),
    project_id: String(raw.project_id),
    shoot_date: String(raw.shoot_date),
    scene_nr: String(raw.scene_nr ?? ''),
    description: String(raw.description ?? ''),
    lens: String(raw.lens ?? ''),
    location: String(raw.location ?? ''),
    framing: String(raw.framing ?? ''),
    audio_notes: String(raw.audio_notes ?? ''),
    status: raw.status as ShotStatus,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  }
}

const statusStyle = (s: ShotStatus) =>
  s === 'open'
    ? styles.st_open
    : s === 'rolling'
      ? styles.st_rolling
      : s === 'done'
        ? styles.st_done
        : styles.st_pick

const statusTextStyle = (s: ShotStatus) =>
  s === 'open' || s === 'rolling' ? styles.statusTxtLight : styles.statusTxtDark

type Props = {
  projectId: string
  userId: string
  projectTitle: string
  projectLocation: string | null
  companyId: string
  briefContext: string | null
  briefOutputs?: Record<string, string> | null
}

const PRODUCTION_SECTIONS = [
  {
    id: 'weather' as const,
    label: 'Weather',
    sub: '7-day forecast for your shoot location (Open-Meteo)',
  },
  {
    id: 'shotlist' as const,
    label: 'Shotlist',
    sub: 'Scene-by-scene list for the calendar day you load below',
  },
  {
    id: 'call_sheet' as const,
    label: 'Call Sheet',
    sub: 'Crew calls, locations, PDF export, and daily wrap',
  },
  {
    id: 'tasks' as const,
    label: 'Tasks',
    sub: 'Brief AI task breakdown synced to production context',
  },
  {
    id: 'equipment' as const,
    label: 'Equipment',
    sub: 'Brief AI equipment list synced to production context',
  },
]

type ProductionSectionId = (typeof PRODUCTION_SECTIONS)[number]['id']

export function ProductionTab({
  projectId,
  userId,
  projectTitle,
  projectLocation,
  companyId,
  briefContext,
  briefOutputs,
}: Props) {
  const [shootDay, setShootDay] = useState(() => todayLocalISODate())
  const [dayInput, setDayInput] = useState(() => todayLocalISODate())
  useEffect(() => {
    setDayInput(shootDay)
  }, [shootDay])
  const isCompany = userId === companyId

  const [shots, setShots] = useState<ProductionShot[]>([])
  const [crew, setCrew] = useState<CrewRow[]>([])
  const [prodDay, setProdDay] = useState<ProductionDayRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyShot, setBusyShot] = useState<string | null>(null)
  const [creatingDay, setCreatingDay] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  /** `null` = category hub; otherwise full-screen feature */
  const [openFeature, setOpenFeature] = useState<ProductionSectionId | null>(null)
  const tasksOutput = (briefOutputs?.tasks ?? '').trim()
  const gearOutput = (briefOutputs?.gear ?? '').trim()

  const load = useCallback(async () => {
    const [shRes, crRes, dayRes] = await Promise.all([
      supabase
        .from('production_shots')
        .select('*')
        .eq('project_id', projectId)
        .eq('shoot_date', shootDay)
        .order('created_at', { ascending: true }),
      supabase
        .from('project_members')
        .select('id, profile_id, member_role, profiles(name)')
        .eq('project_id', projectId)
        .order('member_role', { ascending: true }),
      supabase
        .from('production_days')
        .select('*')
        .eq('project_id', projectId)
        .eq('date', shootDay)
        .maybeSingle(),
    ])

    if (shRes.error) Alert.alert('Shot list', shRes.error.message)
    else
      setShots(
        (shRes.data ?? []).map((row) => normalizeShotRow(row as Record<string, unknown>))
      )

    if (crRes.error) Alert.alert('Crew', crRes.error.message)
    else setCrew((crRes.data as unknown as CrewRow[]) ?? [])

    if (dayRes.error) Alert.alert('Production day', dayRes.error.message)
    else if (dayRes.data) {
      const row = dayRes.data as Record<string, unknown>
      setProdDay({
        id: row.id as string,
        project_id: row.project_id as string,
        date: row.date as string,
        wrap_time: (row.wrap_time as string | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        call_sheet: (row.call_sheet as Record<string, CallOverride>) ?? {},
      })
    } else {
      setProdDay(null)
    }

    setLoading(false)
  }, [projectId, shootDay])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const doneToday = useMemo(
    () => shots.filter((s) => s.status === 'done' || s.status === 'pick').length,
    [shots]
  )
  const totalToday = shots.length
  const progressPct = totalToday ? Math.round((doneToday / totalToday) * 100) : 0

  const upsertShotField = async (id: string, patch: Partial<ProductionShot>) => {
    setBusyShot(id)
    const { error } = await supabase.from('production_shots').update(patch).eq('id', id)
    setBusyShot(null)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const addShot = async () => {
    const { data, error } = await supabase
      .from('production_shots')
      .insert({
        project_id: projectId,
        shoot_date: shootDay,
        scene_nr: '',
        description: '',
        lens: '',
        location: '',
        framing: '',
        audio_notes: '',
        status: 'open',
      })
      .select('*')
      .single()
    if (error) {
      Alert.alert('Shot', error.message)
      return
    }
    setShots((prev) => [...prev, normalizeShotRow(data as Record<string, unknown>)])
  }

  const cycleStatus = (s: ProductionShot) => {
    void upsertShotField(s.id, { status: nextStatus(s.status) })
  }

  const createToday = async () => {
    setCreatingDay(true)
    const { data, error } = await supabase
      .from('production_days')
      .insert({
        project_id: projectId,
        date: shootDay,
        wrap_time: null,
        notes: '',
        call_sheet: {},
      })
      .select('*')
      .single()
    setCreatingDay(false)
    if (error) {
      Alert.alert('Production day', error.message)
      return
    }
    const row = data as Record<string, unknown>
    setProdDay({
      id: row.id as string,
      project_id: row.project_id as string,
      date: row.date as string,
      wrap_time: null,
      notes: '',
      call_sheet: {},
    })
  }

  const saveCallCell = async (profileId: string, patch: CallOverride) => {
    if (!prodDay) return
    const next = { ...prodDay.call_sheet, [profileId]: { ...prodDay.call_sheet[profileId], ...patch } }
    const { error } = await supabase.from('production_days').update({ call_sheet: next }).eq('id', prodDay.id)
    if (error) {
      Alert.alert('Call sheet', error.message)
      return
    }
    setProdDay({ ...prodDay, call_sheet: next })
  }

  const saveNotesBlock = async (notes: string, wrap_time: string | null) => {
    if (!prodDay) return
    setSavingNotes(true)
    const { error } = await supabase
      .from('production_days')
      .update({ notes, wrap_time: wrap_time || null })
      .eq('id', prodDay.id)
    setSavingNotes(false)
    if (error) {
      Alert.alert('Notes', error.message)
      return
    }
    setProdDay({ ...prodDay, notes, wrap_time })
  }

  const buildReportContext = () => {
    const lines: string[] = []
    lines.push(`Project: ${projectTitle}`)
    lines.push(`Date: ${shootDay}`)
    if (briefContext?.trim()) lines.push(`Brief context:\n${briefContext.trim()}`)
    if (shots.length) {
      lines.push('\nShots this day:')
      shots.forEach((s, i) => {
        const bits = [
          `Scene ${s.scene_nr || '—'}`,
          s.location?.trim() ? `Loc: ${s.location.trim()}` : null,
          s.framing?.trim() ? `Framing: ${s.framing.trim()}` : null,
          s.description?.trim() ? `Action: ${s.description.trim()}` : null,
          s.lens?.trim() ? `Lens: ${s.lens.trim()}` : null,
          s.audio_notes?.trim() ? `Audio: ${s.audio_notes.trim()}` : null,
          `Status: ${s.status}`,
        ].filter(Boolean)
        lines.push(`${i + 1}. ${bits.join(' · ')}`)
      })
    }
    if (prodDay?.notes?.trim()) lines.push(`\nTeam notes:\n${prodDay.notes.trim()}`)
    return lines.join('\n')
  }

  const generateReport = async () => {
    setGenerating(true)
    const { data, error } = await supabase.functions.invoke<{ content?: string; error?: string }>('brief-ai', {
      body: {
        projectId,
        tool: 'production_report',
        context: buildReportContext(),
      },
    })
    setGenerating(false)

    if (error) {
      Alert.alert('Brief AI', error.message)
      return
    }
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      Alert.alert('Brief AI', String(data.error))
      return
    }
    const content = data?.content
    if (typeof content !== 'string' || !content.trim()) {
      Alert.alert('Brief AI', 'No content returned.')
      return
    }

    const body = `📋 **Production report (${shootDay})**\n\n${content.trim()}`
    const { error: msgErr } = await supabase.from('project_messages').insert({
      project_id: projectId,
      sender_id: userId,
      body,
    })
    if (msgErr) {
      Alert.alert('Messages', msgErr.message)
      return
    }
    Alert.alert('Saved', 'The report was posted to Messages for everyone.')
  }

  const exportCallSheetPdf = async () => {
    setExportingPdf(true)
    try {
      const rowsHtml = crew
        .map((m) => {
          const prof = m.profiles as { name: string | null } | { name: string | null }[] | null | undefined
          const p = Array.isArray(prof) ? prof[0] : prof
          const name = escapeHtml(p?.name || 'Member')
          const role = escapeHtml(roleLabel(m.member_role))
          const ov = prodDay?.call_sheet[m.profile_id]
          const call = escapeHtml(ov?.call_time?.trim() || '—')
          const loc = escapeHtml(ov?.location?.trim() || projectLocation || '—')
          return `<tr><td>${name}</td><td>${role}</td><td>${call}</td><td>${loc}</td></tr>`
        })
        .join('')

      const notesBlock =
        prodDay?.notes?.trim() ?
          `<h2 style="font-size:16px;margin-top:28px;margin-bottom:10px;">Schedule &amp; travel</h2>
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;line-height:1.45;color:#222;border:1px solid #ddd;padding:12px;border-radius:8px;background:#fafafa;">${escapeHtml(prodDay.notes.trim())}</pre>`
          : ''

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color:#111; padding:24px; }
        h1 { font-size:22px; margin-bottom:8px; }
        .sub { color:#555; margin-bottom:20px; font-size:13px; }
        table { width:100%; border-collapse:collapse; font-size:13px; }
        th, td { border:1px solid #ccc; padding:8px 10px; text-align:left; }
        th { background:#f4f4f4; }
      </style></head><body>
        <h1>Call Sheet</h1>
        <div class="sub">${escapeHtml(projectTitle)} · ${shootDay}</div>
        ${notesBlock}
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Call</th><th>Location</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body></html>`

      const { uri } = await Print.printToFileAsync({ html })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Call Sheet' })
      } else {
        Alert.alert('Share', 'Sharing is not available on this device.')
      }
    } catch (e) {
      Alert.alert('PDF', String(e))
    }
    setExportingPdf(false)
  }

  const showDataLoading = openFeature !== null && openFeature !== 'weather' && loading
  const activeMeta = openFeature ? PRODUCTION_SECTIONS.find((s) => s.id === openFeature) : null

  if (openFeature === null) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.hubContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>
          Choose a category to open weather, shotlist, call sheet, tasks, or equipment. Visible to the whole team.
        </Text>
        {PRODUCTION_SECTIONS.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={styles.categoryCard}
            onPress={() => setOpenFeature(s.id)}
            activeOpacity={0.88}
          >
            <View style={styles.categoryCardText}>
              <Text style={styles.categoryTitle}>{s.label}</Text>
              <Text style={styles.categorySub}>{s.sub}</Text>
            </View>
            <ChevronRight size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    )
  }

  return (
    <View style={styles.detailRoot}>
      <View style={styles.detailHeader}>
        <TouchableOpacity style={styles.detailBack} onPress={() => setOpenFeature(null)} hitSlop={10}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.detailBackText}>Categories</Text>
        </TouchableOpacity>
        <Text style={styles.detailTitle} numberOfLines={1}>
          {activeMeta?.label ?? 'Production'}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {openFeature === 'shotlist' || openFeature === 'call_sheet' ? (
        <View style={styles.shootDayRow}>
          <Text style={styles.shootDayLabel}>Calendar day (YYYY-MM-DD)</Text>
          <View style={styles.shootDayControls}>
            <TextInput
              style={styles.shootDayInput}
              value={dayInput}
              onChangeText={setDayInput}
              placeholder={todayLocalISODate()}
              placeholderTextColor="rgba(255,255,255,0.25)"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.shootDayBtn}
              onPress={() => {
                const v = parseIsoDateInput(dayInput)
                if (!v) {
                  Alert.alert('Date', 'Use a valid date: YYYY-MM-DD')
                  return
                }
                setShootDay(v)
              }}
            >
              <Text style={styles.shootDayBtnText}>Load day</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.shootDayHint}>
            Brief AI → Production sync must use this same date. New shots and call sheet rows use this day.
          </Text>
        </View>
      ) : null}
      {openFeature === 'weather' ? <ProductionWeatherSection initialLocation={projectLocation} /> : null}
      {openFeature === 'tasks' ? (
        <View style={styles.aiDocCard}>
          <Text style={styles.aiDocTitle}>Task breakdown</Text>
          {tasksOutput ? (
            <BriefAiFormattedOutput content={tasksOutput} embedded />
          ) : (
            <Text style={styles.muted}>Generate “Task breakdown” in Brief AI first. It will appear here automatically.</Text>
          )}
        </View>
      ) : null}
      {openFeature === 'equipment' ? (
        <View style={styles.aiDocCard}>
          <Text style={styles.aiDocTitle}>Equipment list</Text>
          {gearOutput ? (
            <BriefAiFormattedOutput content={gearOutput} embedded />
          ) : (
            <Text style={styles.muted}>Generate “Equipment list” in Brief AI first. It will appear here automatically.</Text>
          )}
        </View>
      ) : null}

      {showDataLoading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color="#FFDC00" />
          <Text style={styles.loadingHint}>Loading shots, crew, and day data…</Text>
        </View>
      ) : null}

      {openFeature === 'shotlist' && !loading ? (
        <>
      {/* —— Shot list —— */}
      <Text style={[styles.sectionHead, styles.sectionSp]}>SHOT LIST</Text>
      <Text style={styles.shotListSub}>
        Scene, location, framing, action, lens, and audio — tap status to cycle (Open → Rolling → Done → Pick).
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
      </View>
      <Text style={styles.progressLabel}>
        {doneToday} / {totalToday} shots marked done for {shootDay}
      </Text>

      {shots.map((s, idx) => (
        <View key={s.id} style={styles.shotCard}>
          <View style={styles.shotCardTop}>
            <Text style={styles.shotCardIndex}>Shot {idx + 1}</Text>
            <TouchableOpacity
              style={[styles.statusBtn, statusStyle(s.status)]}
              onPress={() => cycleStatus(s)}
              disabled={busyShot === s.id}
            >
              <Text style={[styles.statusBtnText, statusTextStyle(s.status)]}>{STATUS_LABEL[s.status]}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.shotFieldLabel}>Scene / slate</Text>
          <TextInput
            style={styles.shotInput}
            placeholder="e.g. 3A"
            placeholderTextColor="rgba(255,255,255,0.25)"
            defaultValue={s.scene_nr}
            editable={busyShot !== s.id}
            onEndEditing={(e) => {
              const v = e.nativeEvent.text
              if (v !== s.scene_nr) void upsertShotField(s.id, { scene_nr: v })
            }}
          />

          <Text style={styles.shotFieldLabel}>Location</Text>
          <TextInput
            style={styles.shotInput}
            placeholder="Set, room, stage…"
            placeholderTextColor="rgba(255,255,255,0.25)"
            defaultValue={s.location}
            editable={busyShot !== s.id}
            onEndEditing={(e) => {
              const v = e.nativeEvent.text
              if (v !== s.location) void upsertShotField(s.id, { location: v })
            }}
          />

          <Text style={styles.shotFieldLabel}>Framing</Text>
          <TextInput
            style={styles.shotInput}
            placeholder="e.g. Wide est., MCU, product insert"
            placeholderTextColor="rgba(255,255,255,0.25)"
            defaultValue={s.framing}
            editable={busyShot !== s.id}
            onEndEditing={(e) => {
              const v = e.nativeEvent.text
              if (v !== s.framing) void upsertShotField(s.id, { framing: v })
            }}
          />

          <Text style={styles.shotFieldLabel}>Action / description</Text>
          <TextInput
            style={[styles.shotInput, styles.shotInputTall]}
            placeholder="What happens in the shot, blocking, talent…"
            placeholderTextColor="rgba(255,255,255,0.25)"
            defaultValue={s.description}
            multiline
            textAlignVertical="top"
            editable={busyShot !== s.id}
            onEndEditing={(e) => {
              const v = e.nativeEvent.text
              if (v !== s.description) void upsertShotField(s.id, { description: v })
            }}
          />

          <Text style={styles.shotFieldLabel}>Camera / lens</Text>
          <TextInput
            style={styles.shotInput}
            placeholder="e.g. 35mm, 85mm / FX6"
            placeholderTextColor="rgba(255,255,255,0.25)"
            defaultValue={s.lens}
            editable={busyShot !== s.id}
            onEndEditing={(e) => {
              const v = e.nativeEvent.text
              if (v !== s.lens) void upsertShotField(s.id, { lens: v })
            }}
          />

          <Text style={styles.shotFieldLabel}>Audio</Text>
          <TextInput
            style={[styles.shotInput, styles.shotInputTall]}
            placeholder="Boom, lavs, ambient, music playback…"
            placeholderTextColor="rgba(255,255,255,0.25)"
            defaultValue={s.audio_notes}
            multiline
            textAlignVertical="top"
            editable={busyShot !== s.id}
            onEndEditing={(e) => {
              const v = e.nativeEvent.text
              if (v !== s.audio_notes) void upsertShotField(s.id, { audio_notes: v })
            }}
          />
        </View>
      ))}

      <TouchableOpacity style={[styles.addRowBtn, busyShot && styles.dim]} onPress={addShot} disabled={!!busyShot}>
        <Plus size={20} color="#0a0a0a" strokeWidth={ICON_STROKE} />
        <Text style={styles.addRowBtnText}>Add shot</Text>
      </TouchableOpacity>
        </>
      ) : null}

      {openFeature === 'call_sheet' && !loading ? (
        <>
      {/* —— Call sheet —— */}
      <Text style={[styles.sectionHead, styles.sectionSp]}>CALL SHEET</Text>
      {!prodDay && (
        <Text style={styles.banner}>
          Call sheet and daily wrap are saved once the client creates a production day for the loaded calendar day.
        </Text>
      )}
      {isCompany && !prodDay ? (
        <TouchableOpacity style={[styles.accentBtn, creatingDay && styles.dim]} onPress={createToday} disabled={creatingDay}>
          <Text style={styles.accentBtnText}>{creatingDay ? '…' : `Create production day for ${shootDay}`}</Text>
        </TouchableOpacity>
      ) : null}

      {prodDay && (prodDay.notes ?? '').trim() ? (
        <View style={styles.csLogisticsCard}>
          <View style={styles.csLogisticsHeader}>
            <View style={styles.csLogisticsIcon}>
              <MapPin size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
            </View>
            <View style={styles.csLogisticsHeaderText}>
              <Text style={styles.csLogisticsKicker}>Day logistics</Text>
              <Text style={styles.csLogisticsTitle}>Schedule & travel</Text>
              <Text style={styles.csLogisticsHint}>
                Synced with Daily wrap → Notes (Brief AI apply or manual edits).
              </Text>
            </View>
          </View>
          <BriefAiFormattedOutput content={(prodDay.notes ?? '').trim()} embedded />
        </View>
      ) : null}

      {crew.length > 0 ? (
        <View style={styles.csCrewSection}>
          <View style={styles.csCrewSectionHead}>
            <Users size={18} color="rgba(255,255,255,0.45)" strokeWidth={ICON_STROKE} />
            <Text style={styles.csCrewSectionTitle}>Crew calls</Text>
          </View>
          {crew.map((m) => {
            const prof = m.profiles as { name: string | null } | { name: string | null }[] | null | undefined
            const p = Array.isArray(prof) ? prof[0] : prof
            const ov = prodDay?.call_sheet[m.profile_id]
            const callVal = ov?.call_time ?? ''
            const locVal = ov?.location ?? projectLocation ?? ''
            return (
              <View key={`${m.id}-${prodDay?.id ?? 'none'}`} style={styles.csMemberCard}>
                <View style={styles.csMemberHead}>
                  <Text style={styles.csName}>{p?.name || 'Member'}</Text>
                  <View style={styles.csRolePill}>
                    <Text style={styles.csRolePillText}>{roleLabel(m.member_role)}</Text>
                  </View>
                </View>
                <View style={styles.csFieldRow}>
                  <Clock size={14} color="rgba(255,255,255,0.35)" strokeWidth={ICON_STROKE} />
                  <View style={styles.csFieldGrow}>
                    <Text style={styles.csFieldLabel}>Call time</Text>
                    <TextInput
                      style={styles.csInputBlock}
                      placeholder="e.g. 07:00"
                      placeholderTextColor="rgba(255,255,255,0.25)"
                      defaultValue={callVal}
                      editable={!!prodDay}
                      onEndEditing={(e) => {
                        if (!prodDay) return
                        const v = e.nativeEvent.text
                        if (v !== (ov?.call_time ?? '')) void saveCallCell(m.profile_id, { call_time: v })
                      }}
                    />
                  </View>
                </View>
                <View style={styles.csFieldRow}>
                  <MapPin size={14} color="rgba(255,255,255,0.35)" strokeWidth={ICON_STROKE} />
                  <View style={styles.csFieldGrow}>
                    <Text style={styles.csFieldLabel}>Location / set</Text>
                    <TextInput
                      style={[styles.csInputBlock, styles.csInputBlockTall]}
                      placeholder="Address, stage, parking note…"
                      placeholderTextColor="rgba(255,255,255,0.25)"
                      defaultValue={locVal}
                      editable={!!prodDay}
                      multiline
                      textAlignVertical="top"
                      onEndEditing={(e) => {
                        if (!prodDay) return
                        const v = e.nativeEvent.text
                        if (v !== (ov?.location ?? (projectLocation || ''))) void saveCallCell(m.profile_id, { location: v })
                      }}
                    />
                  </View>
                </View>
              </View>
            )
          })}
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.outlineBtn, exportingPdf && styles.dim]}
        onPress={exportCallSheetPdf}
        disabled={exportingPdf || crew.length === 0}
      >
        <Text style={styles.outlineBtnText}>{exportingPdf ? 'PDF…' : 'Export call sheet as PDF'}</Text>
      </TouchableOpacity>

      {/* —— Daily wrap —— */}
      <Text style={[styles.sectionHead, styles.sectionSp]}>DAILY WRAP</Text>
      <TouchableOpacity style={[styles.accentBtn, generating && styles.dim]} onPress={generateReport} disabled={generating}>
        <Text style={styles.accentBtnText}>{generating ? 'Brief AI…' : 'Generate report (Brief AI)'}</Text>
      </TouchableOpacity>
      <Text style={styles.subtle}>The report is posted to Messages for everyone automatically.</Text>

      <Text style={styles.fieldLabel}>Wrap (optional)</Text>
      <WrapNotesBlock
        prodDay={prodDay}
        saving={savingNotes}
        onSave={(notes, wrap) => void saveNotesBlock(notes, wrap)}
      />
        </>
      ) : null}
      </ScrollView>
    </View>
  )
}

function WrapNotesBlock({
  prodDay,
  saving,
  onSave,
}: {
  prodDay: ProductionDayRow | null
  saving: boolean
  onSave: (notes: string, wrap: string | null) => void
}) {
  const [wrap, setWrap] = useState(prodDay?.wrap_time ?? '')
  const [notes, setNotes] = useState(prodDay?.notes ?? '')

  useEffect(() => {
    setWrap(prodDay?.wrap_time ?? '')
    setNotes(prodDay?.notes ?? '')
  }, [prodDay?.id, prodDay?.wrap_time, prodDay?.notes])

  if (!prodDay) {
    return <Text style={styles.muted}>Notes are available after a production day has been created.</Text>
  }

  return (
    <>
      <TextInput
        style={styles.wrapInput}
        placeholder="e.g. 7:30 PM"
        placeholderTextColor="rgba(255,255,255,0.25)"
        value={wrap}
        onChangeText={setWrap}
        onEndEditing={() => onSave(notes, wrap.trim() || null)}
        editable={!saving}
      />
      <Text style={styles.fieldLabel}>Notes</Text>
      <TextInput
        style={styles.notesInput}
        placeholder="What happened, what's next…"
        placeholderTextColor="rgba(255,255,255,0.25)"
        value={notes}
        onChangeText={setNotes}
        onEndEditing={() => onSave(notes, wrap.trim() || null)}
        multiline
        editable={!saving}
      />
    </>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: 40 },
  hubContent: { paddingBottom: 40, flexGrow: 1 },
  hint: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18, marginBottom: 20 },
  categoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 12,
  },
  categoryCardText: { flex: 1 },
  categoryTitle: { fontSize: 17, fontWeight: '800', color: '#fff', marginBottom: 4 },
  categorySub: { fontSize: 13, color: 'rgba(255,255,255,0.42)', lineHeight: 18 },
  detailRoot: { flex: 1 },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  detailBack: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 6, paddingRight: 8 },
  detailBackText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  detailTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'right',
  },
  shootDayRow: {
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  shootDayLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.38)',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  shootDayControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shootDayInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    backgroundColor: '#111',
  },
  shootDayBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,220,0,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
  },
  shootDayBtnText: { color: '#FFDC00', fontWeight: '800', fontSize: 13 },
  shootDayHint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.32)',
    marginTop: 8,
    lineHeight: 16,
  },
  sectionHead: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 2,
    marginBottom: 12,
  },
  sectionSp: { marginTop: 28 },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1a1a1a',
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFDC00',
    borderRadius: 4,
  },
  progressLabel: { fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 16 },
  shotListSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.38)',
    lineHeight: 17,
    marginBottom: 14,
  },
  shotCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 12,
  },
  shotCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  shotCardIndex: { fontSize: 15, fontWeight: '800', color: '#FFDC00', letterSpacing: 0.3 },
  shotFieldLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.38)',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginTop: 4,
  },
  shotInput: {
    backgroundColor: '#0d0d0d',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    marginBottom: 4,
  },
  shotInputTall: { minHeight: 72, paddingTop: 10, marginBottom: 8 },
  statusBtn: {
    alignSelf: 'center',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statusBtnText: { fontSize: 11, fontWeight: '800' },
  st_open: { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.2)' },
  st_rolling: { backgroundColor: '#378ADD', borderColor: '#378ADD' },
  st_done: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  st_pick: { backgroundColor: '#5fd68a', borderColor: '#5fd68a' },
  statusTxtDark: { color: '#0a0a0a' },
  statusTxtLight: { color: 'rgba(255,255,255,0.95)' },
  addRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFDC00',
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 12,
    marginBottom: 8,
  },
  addRowBtnText: { fontWeight: '800', color: '#0a0a0a', fontSize: 15 },
  dim: { opacity: 0.55 },
  banner: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 12,
    lineHeight: 18,
  },
  accentBtn: {
    backgroundColor: '#378ADD',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  accentBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  outlineBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.45)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  outlineBtnText: { color: '#FFDC00', fontWeight: '700', fontSize: 14 },
  csLogisticsCard: {
    marginBottom: 20,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.22)',
    backgroundColor: '#121212',
  },
  csLogisticsHeader: { flexDirection: 'row', gap: 14, marginBottom: 14 },
  csLogisticsIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,220,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
  },
  csLogisticsHeaderText: { flex: 1, minWidth: 0 },
  csLogisticsKicker: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255,220,0,0.85)',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  csLogisticsTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 6 },
  csLogisticsHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.42)',
    lineHeight: 17,
  },
  csCrewSection: { marginBottom: 8 },
  csCrewSectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    marginTop: 4,
  },
  csCrewSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  csMemberCard: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111',
  },
  csMemberHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  csName: { fontSize: 16, fontWeight: '800', color: '#fff', flex: 1, minWidth: 0 },
  csRolePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  csRolePillText: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  csFieldRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  csFieldGrow: { flex: 1, minWidth: 0 },
  csFieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  csInputBlock: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  csInputBlockTall: { minHeight: 72, paddingTop: 11 },
  subtle: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 16 },
  fieldLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 8,
  },
  wrapInput: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
    marginBottom: 8,
  },
  notesInput: {
    minHeight: 120,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  muted: { fontSize: 13, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },
  aiDocCard: {
    marginTop: 18,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111',
  },
  aiDocTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 12,
  },
  loadingBlock: { paddingVertical: 24, alignItems: 'center', gap: 12 },
  loadingHint: { fontSize: 13, color: 'rgba(255,255,255,0.45)' },
})
