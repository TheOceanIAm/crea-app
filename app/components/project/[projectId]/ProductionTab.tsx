import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  FlatList,
} from 'react-native'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react-native'
import { KeyboardFormModal } from '@/components/KeyboardFormModal'
import { supabase } from '@/lib/supabase'
import { formatShootDayOptionLabel, listProductionWindowYmd } from '@/lib/projectProductionWindow'
import { ICON_STROKE } from '@/lib/iconTheme'
import { ProductionWeatherSection } from '@/components/project/ProductionWeatherSection'
import { ProductionSunPlannerSection } from '@/components/project/ProductionSunPlannerSection'
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
  brief_ai_synced: boolean
  status: ShotStatus
  created_at: string
  updated_at: string
}

type ShotDraft = {
  scene_nr: string
  location: string
  framing: string
  description: string
  lens: string
  audio_notes: string
}

const EMPTY_SHOT_DRAFT: ShotDraft = {
  scene_nr: '',
  location: '',
  framing: '',
  description: '',
  lens: '',
  audio_notes: '',
}

type CallSheetCrewRow = {
  /** Key in production_days.call_sheet (`profile_id` or `manual:<uuid>`). */
  key: string
  name: string
  roleLabel: string
  source: 'member' | 'manual'
}

function manualCallSheetKey(manualId: string) {
  return `manual:${manualId}`
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

function expandFramingAbbreviations(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bECU\b/g, 'Extreme Close-Up'],
    [/\bVCU\b/g, 'Very Close-Up'],
    [/\bCU\b/g, 'Close-Up'],
    [/\bMCU\b/g, 'Medium Close-Up'],
    [/\bMS\b/g, 'Medium Shot'],
    [/\bMLS\b/g, 'Medium Long Shot'],
    [/\bWS\b/g, 'Wide Shot'],
    [/\bEWS\b/g, 'Extreme Wide Shot'],
    [/\bOTS\b/g, 'Over-the-Shoulder'],
    [/\bPOV\b/g, 'Point of View'],
    [/\bINSERT\b/g, 'Insert Shot'],
  ]
  return replacements.reduce((acc, [pattern, full]) => acc.replace(pattern, full), value)
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
    framing: expandFramingAbbreviations(String(raw.framing ?? '')),
    audio_notes: String(raw.audio_notes ?? ''),
    brief_ai_synced: Boolean(raw.brief_ai_synced),
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
  canUseProductionWeather?: boolean
  canUseSunPlanner?: boolean
  /** When Weather (Production) is gated (e.g. Workspace trial ended). */
  productionWeatherLockedHint?: string | null
  /** When Sun Planner is gated (e.g. trial ended); overrides default upgrade copy. */
  sunPlannerLockedHint?: string | null
  /** Inclusive production window from workspace Overview. */
  productionWindowStart?: string | null
  productionWindowEnd?: string | null
  /** Deep-link / capture: open a production feature directly (hub when null). */
  initialFeature?: 'sun' | 'weather' | 'shotlist' | 'call_sheet' | 'tasks' | 'equipment' | null
  /** Deep-link / capture: YYYY-MM-DD shoot day to load. */
  initialShootDay?: string | null
}

const PRODUCTION_SECTIONS = [
  {
    id: 'sun' as const,
    label: 'Sun Planner',
    sub: 'Sunrise, sunset, golden hour, and sun-angle preview for your shoot',
  },
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
  canUseProductionWeather = false,
  canUseSunPlanner = false,
  productionWeatherLockedHint,
  sunPlannerLockedHint,
  productionWindowStart,
  productionWindowEnd,
  initialFeature = null,
  initialShootDay = null,
}: Props) {
  const bootDay =
    typeof initialShootDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(initialShootDay.trim())
      ? initialShootDay.trim().slice(0, 10)
      : todayLocalISODate()
  const [shootDay, setShootDay] = useState(bootDay)
  const [dayInput, setDayInput] = useState(bootDay)
  const [dayPickerOpen, setDayPickerOpen] = useState(false)
  const [windowStart, setWindowStart] = useState(productionWindowStart?.trim().slice(0, 10) ?? '')
  const [windowEnd, setWindowEnd] = useState(productionWindowEnd?.trim().slice(0, 10) ?? '')

  const productionDays = useMemo(
    () => listProductionWindowYmd(windowStart, windowEnd),
    [windowStart, windowEnd]
  )
  useEffect(() => {
    setDayInput(shootDay)
  }, [shootDay])
  const isCompany = userId === companyId

  useEffect(() => {
    const a = productionWindowStart?.trim().slice(0, 10) ?? ''
    const b = productionWindowEnd?.trim().slice(0, 10) ?? ''
    if (a) setWindowStart(a)
    if (b) setWindowEnd(b)
  }, [productionWindowStart, productionWindowEnd])

  useEffect(() => {
    if (!projectId) return
    if (windowStart && windowEnd) return
    void (async () => {
      const { data } = await supabase
        .from('projects')
        .select('scheduling_start_date, scheduling_end_date')
        .eq('id', projectId)
        .maybeSingle()
      if (!data) return
      const row = data as { scheduling_start_date?: string | null; scheduling_end_date?: string | null }
      const a = typeof row.scheduling_start_date === 'string' ? row.scheduling_start_date.slice(0, 10) : ''
      const b = typeof row.scheduling_end_date === 'string' ? row.scheduling_end_date.slice(0, 10) : ''
      if (/^\d{4}-\d{2}-\d{2}$/.test(a)) setWindowStart(a)
      if (/^\d{4}-\d{2}-\d{2}$/.test(b)) setWindowEnd(b)
    })()
  }, [projectId, windowStart, windowEnd])

  useEffect(() => {
    if (productionDays.length === 0) return
    if (!productionDays.includes(shootDay)) {
      setShootDay(productionDays[0])
    }
  }, [productionDays])

  const [shots, setShots] = useState<ProductionShot[]>([])
  const [crew, setCrew] = useState<CallSheetCrewRow[]>([])
  const [addManualOpen, setAddManualOpen] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualRole, setManualRole] = useState('')
  const [addingManual, setAddingManual] = useState(false)
  const [prodDay, setProdDay] = useState<ProductionDayRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyShot, setBusyShot] = useState<string | null>(null)
  const [editingShotId, setEditingShotId] = useState<string | null>(null)
  const [shotDrafts, setShotDrafts] = useState<Record<string, ShotDraft>>({})
  const [addShotOpen, setAddShotOpen] = useState(false)
  const [newShotDraft, setNewShotDraft] = useState<ShotDraft>(EMPTY_SHOT_DRAFT)
  const [savingNewShot, setSavingNewShot] = useState(false)
  const [creatingDay, setCreatingDay] = useState(false)
  const [savingCallSheet, setSavingCallSheet] = useState(false)
  const [callDraft, setCallDraft] = useState<Record<string, CallOverride>>({})
  const [wrapDraft, setWrapDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [callSheetDirty, setCallSheetDirty] = useState(false)
  const callSheetDirtyRef = useRef(false)
  const prevCallSheetOpenRef = useRef(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  /** `null` = category hub; otherwise full-screen feature */
  const [openFeature, setOpenFeature] = useState<ProductionSectionId | null>(initialFeature ?? null)

  useEffect(() => {
    if (!initialFeature) return
    setOpenFeature(initialFeature)
  }, [initialFeature])

  useEffect(() => {
    if (!initialShootDay) return
    const v = initialShootDay.trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return
    setShootDay(v)
    setDayInput(v)
  }, [initialShootDay])
  const tasksOutput = (briefOutputs?.tasks ?? '').trim()
  const gearOutput = (briefOutputs?.gear ?? '').trim()

  const load = useCallback(async () => {
    const [shRes, crRes, dayRes, manualRes] = await Promise.all([
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
      supabase
        .from('project_manual_crew_readable')
        .select('id, name, member_role, claimed_profile_id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true }),
    ])

    if (shRes.error) Alert.alert('Shot list', shRes.error.message)
    else
      setShots(
        (shRes.data ?? []).map((row) => normalizeShotRow(row as Record<string, unknown>))
      )

    let members: CallSheetCrewRow[] = []
    if (crRes.error) {
      Alert.alert('Crew', crRes.error.message)
    } else {
      members = ((crRes.data ?? []) as Array<{
        id: string
        profile_id: string
        member_role: string
        profiles: { name: string | null } | { name: string | null }[] | null
      }>).map((m) => {
        const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        return {
          key: m.profile_id,
          name: (prof?.name && String(prof.name).trim()) || 'Member',
          roleLabel: roleLabel(m.member_role),
          source: 'member' as const,
        }
      })
    }

    let manualRows: CallSheetCrewRow[] = []
    let manualData = manualRes.data
    if (manualRes.error) {
      console.warn('[ProductionTab] project_manual_crew', manualRes.error.message)
      const retry = await supabase
        .from('project_manual_crew_readable')
        .select('id, name, member_role, claimed_profile_id')
        .eq('project_id', projectId)
      if (retry.error) {
        Alert.alert('External crew', retry.error.message)
      } else {
        manualData = retry.data
      }
    }
    manualRows = ((manualData ?? []) as Array<{
      id: string
      name: string
      member_role: string | null
      claimed_profile_id?: string | null
    }>)
      .filter((m) => !(typeof m.claimed_profile_id === 'string' && m.claimed_profile_id.trim()))
      .map((m) => ({
      key: manualCallSheetKey(m.id),
      name: (m.name && m.name.trim()) || 'Crew',
      roleLabel: (m.member_role && m.member_role.trim()) || 'Crew',
      source: 'manual' as const,
    }))

    let callSheet: Record<string, CallOverride> = {}
    if (dayRes.error) {
      Alert.alert('Production day', dayRes.error.message)
      setProdDay(null)
    } else if (dayRes.data) {
      const row = dayRes.data as Record<string, unknown>
      callSheet = (row.call_sheet as Record<string, CallOverride>) ?? {}
      setProdDay({
        id: row.id as string,
        project_id: row.project_id as string,
        date: row.date as string,
        wrap_time: (row.wrap_time as string | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        call_sheet: callSheet,
      })
    } else {
      setProdDay(null)
    }

    // Union directory + anyone already saved on this day's call sheet (manual:<uuid>).
    const byKey = new Map<string, CallSheetCrewRow>()
    for (const m of members) byKey.set(m.key, m)
    for (const m of manualRows) byKey.set(m.key, m)
    const missingManualIds: string[] = []
    for (const key of Object.keys(callSheet)) {
      if (!key.startsWith('manual:') || byKey.has(key)) continue
      const id = key.slice('manual:'.length).trim()
      if (id) missingManualIds.push(id)
      byKey.set(key, {
        key,
        name: 'External',
        roleLabel: 'Crew',
        source: 'manual',
      })
    }
    if (missingManualIds.length > 0) {
      const { data: byId } = await supabase
        .from('project_manual_crew_readable')
        .select('id, name, member_role')
        .in('id', missingManualIds)
      for (const m of byId ?? []) {
        const row = m as { id: string; name: string; member_role: string | null }
        const key = manualCallSheetKey(row.id)
        byKey.set(key, {
          key,
          name: (row.name && row.name.trim()) || 'Crew',
          roleLabel: (row.member_role && row.member_role.trim()) || 'Crew',
          source: 'manual',
        })
      }
    }
    setCrew([...byKey.values()])

    setLoading(false)
  }, [projectId, shootDay])

  const applyProdDayToDrafts = useCallback((row: ProductionDayRow) => {
    setProdDay(row)
    if (callSheetDirtyRef.current) return
    setCallDraft(row.call_sheet ?? {})
    setWrapDraft(row.wrap_time ?? '')
    setNotesDraft(row.notes ?? '')
  }, [])

  const parseProdDayRow = (raw: Record<string, unknown>): ProductionDayRow | null => {
    const id = raw.id
    const project_id = raw.project_id
    if (id == null || project_id == null) return null
    return {
      id: String(id),
      project_id: String(project_id),
      date: String(raw.date ?? '').slice(0, 10),
      wrap_time: (raw.wrap_time as string | null) ?? null,
      notes: (raw.notes as string | null) ?? null,
      call_sheet: (raw.call_sheet as Record<string, CallOverride>) ?? {},
    }
  }

  useEffect(() => {
    callSheetDirtyRef.current = callSheetDirty
  }, [callSheetDirty])

  useEffect(() => {
    if (!prodDay) {
      setCallDraft({})
      setWrapDraft('')
      setNotesDraft('')
      setCallSheetDirty(false)
      callSheetDirtyRef.current = false
      return
    }
    if (callSheetDirty) return
    setCallDraft(prodDay.call_sheet ?? {})
    setWrapDraft(prodDay.wrap_time ?? '')
    setNotesDraft(prodDay.notes ?? '')
  }, [prodDay, shootDay, callSheetDirty])

  const fetchProdDayOnly = useCallback(async () => {
    if (!projectId || !shootDay) return
    const { data, error } = await supabase
      .from('production_days')
      .select('*')
      .eq('project_id', projectId)
      .eq('date', shootDay)
      .maybeSingle()
    if (error) {
      Alert.alert('Call sheet', error.message)
      return
    }
    if (!data) {
      if (!callSheetDirtyRef.current) setProdDay(null)
      return
    }
    const row = parseProdDayRow(data as Record<string, unknown>)
    if (row) applyProdDayToDrafts(row)
  }, [projectId, shootDay, applyProdDayToDrafts])

  useEffect(() => {
    const open = openFeature === 'call_sheet'
    const entered = open && !prevCallSheetOpenRef.current
    prevCallSheetOpenRef.current = open
    if (!entered || !projectId || !shootDay) return
    void fetchProdDayOnly()
  }, [openFeature, projectId, shootDay, fetchProdDayOnly])

  useEffect(() => {
    if (openFeature !== 'call_sheet') return
    // Re-fetch when opening Call Sheet so web-added external crew appears immediately.
    void load()
  }, [openFeature, load])

  useEffect(() => {
    if (openFeature !== 'call_sheet' || !projectId || !shootDay) return

    const channel = supabase
      .channel(`production-day-${projectId}-${shootDay}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'production_days',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown> | undefined
          if (!row?.id) return
          const parsed = parseProdDayRow(row)
          if (!parsed || parsed.date !== shootDay) return
          if (callSheetDirtyRef.current) return
          applyProdDayToDrafts(parsed)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [openFeature, projectId, shootDay, applyProdDayToDrafts])

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
    const { error } = await supabase
      .from('production_shots')
      .update(patch)
      .eq('id', id)
      .eq('project_id', projectId)
    setBusyShot(null)
    if (error) {
      Alert.alert('Save failed', error.message)
      return false
    }
    setShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    return true
  }

  const beginEditShot = (s: ProductionShot) => {
    setShotDrafts((prev) => ({
      ...prev,
      [s.id]: {
        scene_nr: s.scene_nr ?? '',
        location: s.location ?? '',
        framing: expandFramingAbbreviations(s.framing ?? ''),
        description: s.description ?? '',
        lens: s.lens ?? '',
        audio_notes: s.audio_notes ?? '',
      },
    }))
    setEditingShotId(s.id)
  }

  const saveEditingShot = async (s: ProductionShot) => {
    const draft = shotDrafts[s.id]
    if (!draft) {
      setEditingShotId(null)
      return
    }
    const normalized: ShotDraft = {
      ...draft,
      framing: expandFramingAbbreviations(draft.framing),
    }
    const ok = await upsertShotField(s.id, normalized)
    if (!ok) return
    setEditingShotId(null)
    await load()
  }

  const openAddShotModal = () => {
    setNewShotDraft(EMPTY_SHOT_DRAFT)
    setAddShotOpen(true)
  }

  const closeAddShotModal = () => {
    if (savingNewShot) return
    setAddShotOpen(false)
    setNewShotDraft(EMPTY_SHOT_DRAFT)
  }

  const saveNewShot = async () => {
    setSavingNewShot(true)
    const framing = expandFramingAbbreviations(newShotDraft.framing)
    const { data, error } = await supabase
      .from('production_shots')
      .insert({
        project_id: projectId,
        shoot_date: shootDay,
        scene_nr: newShotDraft.scene_nr.trim(),
        description: newShotDraft.description.trim(),
        lens: newShotDraft.lens.trim(),
        location: newShotDraft.location.trim(),
        framing,
        audio_notes: newShotDraft.audio_notes.trim(),
        brief_ai_synced: false,
        status: 'open',
      })
      .select('*')
      .single()
    setSavingNewShot(false)
    if (error) {
      Alert.alert('Shot', error.message)
      return
    }
    if (data) {
      setShots((prev) => [...prev, normalizeShotRow(data as Record<string, unknown>)])
      setAddShotOpen(false)
      setNewShotDraft(EMPTY_SHOT_DRAFT)
    }
  }

  const deleteShot = (s: ProductionShot) => {
    const label = s.scene_nr?.trim() ? ` “${s.scene_nr.trim()}”` : ''
    Alert.alert('Delete shot', `Remove this shot${label}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void confirmDeleteShot(s),
      },
    ])
  }

  const confirmDeleteShot = async (s: ProductionShot) => {
    setBusyShot(s.id)
    const { error } = await supabase
      .from('production_shots')
      .delete()
      .eq('id', s.id)
      .eq('project_id', projectId)
    setBusyShot(null)
    if (error) {
      Alert.alert('Shot', error.message)
      return
    }
    setShots((prev) => prev.filter((row) => row.id !== s.id))
    if (editingShotId === s.id) setEditingShotId(null)
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

  const saveCallSheet = async () => {
    if (!prodDay) return
    setSavingCallSheet(true)
    const wrap_time = wrapDraft.trim() || null
    const { error } = await supabase
      .from('production_days')
      .update({
        call_sheet: callDraft,
        notes: notesDraft,
        wrap_time,
      })
      .eq('id', prodDay.id)
    setSavingCallSheet(false)
    if (error) {
      Alert.alert('Call sheet', error.message)
      return
    }
    const saved: ProductionDayRow = { ...prodDay, call_sheet: callDraft, notes: notesDraft, wrap_time }
    setProdDay(saved)
    setCallSheetDirty(false)
    callSheetDirtyRef.current = false
    Alert.alert('Saved', 'Call sheet saved — web workspace updates automatically.')
  }

  const addManualToCallSheet = async () => {
    if (!isCompany || addingManual) return
    const name = manualName.trim()
    if (name.length < 2) {
      Alert.alert('Add person', 'Please enter at least 2 characters for the name.')
      return
    }
    setAddingManual(true)
    const { error } = await supabase.from('project_manual_crew').insert({
      project_id: projectId,
      name,
      member_role: manualRole.trim() || 'crew',
      email: null,
      phone: null,
      created_by: userId,
    })
    setAddingManual(false)
    if (error) {
      Alert.alert('Could not add', error.message)
      return
    }
    setManualName('')
    setManualRole('')
    setAddManualOpen(false)
    void load()
  }

  const exportCallSheetPdf = async () => {
    setExportingPdf(true)
    try {
      const rowsHtml = crew
        .map((m) => {
          const name = escapeHtml(m.name || 'Member')
          const role = escapeHtml(m.roleLabel)
          const ov = callDraft[m.key]
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
          <Text style={styles.shootDayLabel}>Shoot day</Text>
          {productionDays.length > 0 ? (
            <TouchableOpacity
              style={styles.shootDaySelect}
              onPress={() => setDayPickerOpen(true)}
              activeOpacity={0.88}
            >
              <Text style={styles.shootDaySelectText} numberOfLines={1}>
                {formatShootDayOptionLabel(shootDay)}
              </Text>
              <ChevronDown size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          ) : (
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
            </View>
          )}
          <TouchableOpacity
            style={styles.shootDayBtn}
            onPress={() => {
              if (productionDays.length > 0) {
                void load()
                return
              }
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
          <Text style={styles.shootDayHint}>
            {productionDays.length > 0
              ? 'Days from the workspace production window. Pick a day, then Load day to refresh.'
              : 'Set the production window on Overview for a day list, or enter YYYY-MM-DD manually.'}
          </Text>
          <Modal
            visible={dayPickerOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setDayPickerOpen(false)}
          >
            <Pressable style={styles.dayPickerBackdrop} onPress={() => setDayPickerOpen(false)}>
              <Pressable style={styles.dayPickerSheet} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.dayPickerTitle}>Production days</Text>
                <FlatList
                  data={productionDays}
                  keyExtractor={(d) => d}
                  style={styles.dayPickerList}
                  renderItem={({ item }) => {
                    const active = item === shootDay
                    return (
                      <TouchableOpacity
                        style={[styles.dayPickerRow, active && styles.dayPickerRowActive]}
                        onPress={() => {
                          setDayPickerOpen(false)
                          setDayInput(item)
                          setShootDay(item)
                        }}
                      >
                        <Text style={[styles.dayPickerRowText, active && styles.dayPickerRowTextActive]}>
                          {formatShootDayOptionLabel(item)}
                        </Text>
                      </TouchableOpacity>
                    )
                  }}
                />
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      ) : null}
      {openFeature === 'weather' ? (
        canUseProductionWeather ? (
          <ProductionWeatherSection initialLocation={projectLocation} />
        ) : (
          <View style={styles.aiDocCard}>
            <Text style={styles.aiDocTitle}>Weather</Text>
            <Text style={styles.muted}>
              {productionWeatherLockedHint?.trim()
                ? productionWeatherLockedHint.trim()
                : 'Weather requires an upgraded plan on Workspace after the 14-day trial. Upgrade to Pro or Premium for full access.'}
            </Text>
          </View>
        )
      ) : null}
      {openFeature === 'sun' ? (
        canUseSunPlanner ? (
          <ProductionSunPlannerSection initialLocation={projectLocation} />
        ) : (
          <View style={styles.aiDocCard}>
            <Text style={styles.aiDocTitle}>Sun Planner</Text>
            <Text style={styles.muted}>
              {sunPlannerLockedHint?.trim()
                ? sunPlannerLockedHint.trim()
                : 'Available on Freelancer Starter+ and Company Studio+ plans. Upgrade to unlock this feature.'}
            </Text>
          </View>
        )
      ) : null}
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
            <View style={styles.shotCardTopLeft}>
              <Text style={styles.shotCardIndex}>Shot {idx + 1}</Text>
              {s.brief_ai_synced ? <Text style={styles.syncedBadge}>Gesetzt (Brief AI)</Text> : null}
            </View>
            <View style={styles.shotCardTopActions}>
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => {
                  if (editingShotId === s.id) {
                    void saveEditingShot(s)
                  } else {
                    beginEditShot(s)
                  }
                }}
                disabled={busyShot === s.id}
              >
                {editingShotId === s.id ? (
                  <Check size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
                ) : (
                  <Pencil size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => deleteShot(s)}
                disabled={busyShot === s.id}
              >
                <Trash2 size={16} color="#f87171" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusBtn, statusStyle(s.status)]}
                onPress={() => cycleStatus(s)}
                disabled={busyShot === s.id}
              >
                <Text style={[styles.statusBtnText, statusTextStyle(s.status)]}>{STATUS_LABEL[s.status]}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {editingShotId === s.id ? (
            <>
              <Text style={styles.shotFieldLabel}>Scene / slate</Text>
              <TextInput
                style={styles.shotInput}
                placeholder="e.g. 3A"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={shotDrafts[s.id]?.scene_nr ?? ''}
                editable={busyShot !== s.id}
                onChangeText={(v) =>
                  setShotDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], scene_nr: v } }))
                }
              />

              <Text style={styles.shotFieldLabel}>Location</Text>
              <TextInput
                style={styles.shotInput}
                placeholder="Set, room, stage…"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={shotDrafts[s.id]?.location ?? ''}
                editable={busyShot !== s.id}
                onChangeText={(v) =>
                  setShotDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], location: v } }))
                }
              />

              <Text style={styles.shotFieldLabel}>Framing</Text>
              <TextInput
                style={styles.shotInput}
                placeholder="e.g. Wide est., MCU, product insert"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={shotDrafts[s.id]?.framing ?? ''}
                editable={busyShot !== s.id}
                onChangeText={(v) =>
                  setShotDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], framing: v } }))
                }
              />

              <Text style={styles.shotFieldLabel}>Action / description</Text>
              <TextInput
                style={[styles.shotInput, styles.shotInputTall]}
                placeholder="What happens in the shot, blocking, talent…"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={shotDrafts[s.id]?.description ?? ''}
                multiline
                textAlignVertical="top"
                editable={busyShot !== s.id}
                onChangeText={(v) =>
                  setShotDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], description: v } }))
                }
              />

              <Text style={styles.shotFieldLabel}>Camera / lens</Text>
              <TextInput
                style={styles.shotInput}
                placeholder="e.g. 35mm, 85mm / FX6"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={shotDrafts[s.id]?.lens ?? ''}
                editable={busyShot !== s.id}
                onChangeText={(v) =>
                  setShotDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], lens: v } }))
                }
              />

              <Text style={styles.shotFieldLabel}>Audio</Text>
              <TextInput
                style={[styles.shotInput, styles.shotInputTall]}
                placeholder="Boom, lavs, ambient, music playback…"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={shotDrafts[s.id]?.audio_notes ?? ''}
                multiline
                textAlignVertical="top"
                editable={busyShot !== s.id}
                onChangeText={(v) =>
                  setShotDrafts((prev) => ({ ...prev, [s.id]: { ...prev[s.id], audio_notes: v } }))
                }
              />
            </>
          ) : (
            <View style={styles.shotSummary}>
              <Text style={styles.shotSummaryLine}>
                <Text style={styles.shotSummaryLabel}>Scene:</Text> {s.scene_nr || '—'}
              </Text>
              <Text style={styles.shotSummaryLine}>
                <Text style={styles.shotSummaryLabel}>Location:</Text> {s.location || '—'}
              </Text>
              <Text style={styles.shotSummaryLine}>
                <Text style={styles.shotSummaryLabel}>Framing:</Text> {s.framing || '—'}
              </Text>
              <Text style={styles.shotSummaryLine}>
                <Text style={styles.shotSummaryLabel}>Action:</Text> {s.description || '—'}
              </Text>
              <Text style={styles.shotSummaryLine}>
                <Text style={styles.shotSummaryLabel}>Camera/Lens:</Text> {s.lens || '—'}
              </Text>
              <Text style={styles.shotSummaryLine}>
                <Text style={styles.shotSummaryLabel}>Audio:</Text> {s.audio_notes || '—'}
              </Text>
            </View>
          )}
        </View>
      ))}

      <TouchableOpacity
        style={[styles.addRowBtn, busyShot && styles.dim]}
        onPress={openAddShotModal}
        disabled={!!busyShot}
      >
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

      {prodDay && (notesDraft.trim() || (prodDay.notes ?? '').trim()) ? (
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
          <BriefAiFormattedOutput content={(notesDraft || prodDay.notes || '').trim()} embedded />
        </View>
      ) : null}

      {prodDay && isCompany ? (
        <View style={{ marginBottom: 12 }}>
          <TouchableOpacity
            style={styles.addRowBtn}
            onPress={() => setAddManualOpen((o) => !o)}
            disabled={addingManual}
          >
            <Plus size={18} color="#0a0a0a" strokeWidth={ICON_STROKE} />
            <Text style={styles.addRowBtnText}>
              {addManualOpen ? 'Cancel' : 'Add person (no Crea account)'}
            </Text>
          </TouchableOpacity>
          {addManualOpen ? (
            <View style={[styles.csMemberCard, { marginTop: 10 }]}>
              <Text style={styles.csFieldLabel}>Name</Text>
              <TextInput
                style={styles.csInputBlock}
                placeholder="Name"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={manualName}
                onChangeText={setManualName}
              />
              <Text style={[styles.csFieldLabel, { marginTop: 8 }]}>Role</Text>
              <TextInput
                style={styles.csInputBlock}
                placeholder="e.g. Gaffer"
                placeholderTextColor="rgba(255,255,255,0.25)"
                value={manualRole}
                onChangeText={setManualRole}
              />
              <TouchableOpacity
                style={[styles.accentBtn, { marginTop: 12 }, addingManual && styles.dim]}
                onPress={() => void addManualToCallSheet()}
                disabled={addingManual}
              >
                <Text style={styles.accentBtnText}>{addingManual ? '…' : 'Add to call sheet'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      {crew.length > 0 ? (
        <View style={styles.csCrewSection}>
          <View style={styles.csCrewSectionHead}>
            <Users size={18} color="rgba(255,255,255,0.45)" strokeWidth={ICON_STROKE} />
            <Text style={styles.csCrewSectionTitle}>Crew calls</Text>
          </View>
          {crew.map((m) => {
            const ov = callDraft[m.key]
            const callVal = ov?.call_time ?? ''
            const locVal = ov?.location ?? ''
            return (
              <View key={`${m.key}-${prodDay?.id ?? 'none'}`} style={styles.csMemberCard}>
                <View style={styles.csMemberHead}>
                  <Text style={styles.csName}>
                    {m.name}
                    {m.source === 'manual' ? ' · external' : ''}
                  </Text>
                  <View style={styles.csRolePill}>
                    <Text style={styles.csRolePillText}>{m.roleLabel}</Text>
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
                      value={callVal}
                      editable={!!prodDay}
                      onChangeText={(v) => {
                        setCallSheetDirty(true)
                        callSheetDirtyRef.current = true
                        setCallDraft((prev) => ({
                          ...prev,
                          [m.key]: { ...(prev[m.key] ?? {}), call_time: v },
                        }))
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
                      value={locVal}
                      editable={!!prodDay}
                      multiline
                      textAlignVertical="top"
                      onChangeText={(v) => {
                        setCallSheetDirty(true)
                        callSheetDirtyRef.current = true
                        setCallDraft((prev) => ({
                          ...prev,
                          [m.key]: { ...(prev[m.key] ?? {}), location: v },
                        }))
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
      <Text style={styles.fieldLabel}>Wrap (optional)</Text>
      {prodDay ? (
        <>
          <TextInput
            style={styles.wrapInput}
            placeholder="e.g. 7:30 PM"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={wrapDraft}
            onChangeText={(v) => {
              setCallSheetDirty(true)
              callSheetDirtyRef.current = true
              setWrapDraft(v)
            }}
            editable={!savingCallSheet}
          />
          <Text style={styles.fieldLabel}>Notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="What happened, what's next…"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={notesDraft}
            onChangeText={(v) => {
              setCallSheetDirty(true)
              callSheetDirtyRef.current = true
              setNotesDraft(v)
            }}
            multiline
            editable={!savingCallSheet}
          />
          <TouchableOpacity
            style={[
              styles.saveCallSheetBtn,
              (savingCallSheet || !callSheetDirty) && styles.dim,
            ]}
            onPress={() => void saveCallSheet()}
            disabled={savingCallSheet || !callSheetDirty}
          >
            <Text style={styles.saveCallSheetBtnText}>
              {savingCallSheet ? 'Saving…' : 'Save call sheet'}
            </Text>
          </TouchableOpacity>
          {!callSheetDirty && !savingCallSheet ? (
            <Text style={styles.subtle}>Saved — syncs to web automatically.</Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.muted}>Notes are available after a production day has been created.</Text>
      )}
        </>
      ) : null}
      </ScrollView>

      <KeyboardFormModal visible={addShotOpen} onClose={closeAddShotModal}>
        <Text style={styles.modalTitle}>New shot</Text>
        <Text style={styles.modalSub}>Shoot day {formatShootDayOptionLabel(shootDay)}</Text>

        <Text style={styles.shotFieldLabel}>Scene / slate</Text>
        <TextInput
          style={styles.shotInput}
          placeholder="e.g. 3A"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={newShotDraft.scene_nr}
          onChangeText={(v) => setNewShotDraft((prev) => ({ ...prev, scene_nr: v }))}
        />

        <Text style={styles.shotFieldLabel}>Location</Text>
        <TextInput
          style={styles.shotInput}
          placeholder="Set, room, stage…"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={newShotDraft.location}
          onChangeText={(v) => setNewShotDraft((prev) => ({ ...prev, location: v }))}
        />

        <Text style={styles.shotFieldLabel}>Framing</Text>
        <TextInput
          style={styles.shotInput}
          placeholder="e.g. Wide est., MCU, product insert"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={newShotDraft.framing}
          onChangeText={(v) => setNewShotDraft((prev) => ({ ...prev, framing: v }))}
        />

        <Text style={styles.shotFieldLabel}>Action / description</Text>
        <TextInput
          style={[styles.shotInput, styles.shotInputTall]}
          placeholder="What happens in the shot, blocking, talent…"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={newShotDraft.description}
          multiline
          textAlignVertical="top"
          onChangeText={(v) => setNewShotDraft((prev) => ({ ...prev, description: v }))}
        />

        <Text style={styles.shotFieldLabel}>Camera / lens</Text>
        <TextInput
          style={styles.shotInput}
          placeholder="e.g. 35mm, 85mm / FX6"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={newShotDraft.lens}
          onChangeText={(v) => setNewShotDraft((prev) => ({ ...prev, lens: v }))}
        />

        <Text style={styles.shotFieldLabel}>Audio</Text>
        <TextInput
          style={[styles.shotInput, styles.shotInputTall]}
          placeholder="Boom, lavs, ambient, music playback…"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={newShotDraft.audio_notes}
          multiline
          textAlignVertical="top"
          onChangeText={(v) => setNewShotDraft((prev) => ({ ...prev, audio_notes: v }))}
        />

        <View style={styles.modalActions}>
          <TouchableOpacity
            style={[styles.modalBtn, styles.modalBtnGhost]}
            onPress={closeAddShotModal}
            disabled={savingNewShot}
          >
            <Text style={styles.modalBtnGhostText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modalBtn, styles.modalBtnAccent, savingNewShot && styles.dim]}
            onPress={() => void saveNewShot()}
            disabled={savingNewShot}
          >
            <Text style={styles.modalBtnAccentText}>{savingNewShot ? 'Saving…' : 'Add shot'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardFormModal>
    </View>
  )
}

export default ProductionTab

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
  shootDaySelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  shootDaySelectText: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
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
  dayPickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  dayPickerSheet: {
    maxHeight: '55%',
    backgroundColor: '#141414',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
    paddingTop: 16,
    paddingBottom: 24,
  },
  dayPickerTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 18,
    marginBottom: 8,
  },
  dayPickerList: { paddingHorizontal: 12 },
  dayPickerRow: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 6,
  },
  dayPickerRowActive: {
    backgroundColor: 'rgba(255,220,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
  },
  dayPickerRowText: { color: 'rgba(255,255,255,0.85)', fontSize: 16, fontWeight: '600' },
  dayPickerRowTextActive: { color: '#FFDC00' },
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
  shotCardTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  shotCardTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shotCardIndex: { fontSize: 15, fontWeight: '800', color: '#FFDC00', letterSpacing: 0.3 },
  syncedBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0a0a0a',
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  editBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.45)',
    backgroundColor: 'rgba(255,220,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: { fontSize: 30, fontWeight: '900', color: '#FFDC00', textTransform: 'uppercase', marginBottom: 6 },
  modalSub: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 16, lineHeight: 18 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalBtn: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  modalBtnGhostText: { color: 'rgba(255,255,255,0.8)', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  modalBtnAccent: { backgroundColor: '#FFDC00' },
  modalBtnAccentText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14, textAlign: 'center' },
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
  shotSummary: { gap: 6 },
  shotSummaryLine: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.86)',
    lineHeight: 19,
  },
  shotSummaryLabel: {
    color: 'rgba(255,220,0,0.9)',
    fontWeight: '700',
  },
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
    marginBottom: 4,
  },
  saveCallSheetBtn: {
    marginTop: 20,
    backgroundColor: '#FFDC00',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  saveCallSheetBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 15 },
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
