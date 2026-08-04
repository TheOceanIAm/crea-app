import { useCallback, useEffect, useRef, useState } from 'react'
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
  Linking,
  Image,
  useWindowDimensions,
} from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { Trash2, ChevronDown } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { cancelCrewInvite, listProjectCrewInvites, type ProjectCrewInvite } from '@/lib/crewInvites'
import { ICON_STROKE } from '@/lib/iconTheme'
import {
  clampBookedEntriesToWindow,
  calendarDatesFromSlots,
  cycleBookedDaySlot,
  formatBookedSlotsSummary,
  memberBookedSlotsFromRow,
  serializeBookedDateEntries,
  syncSchedulingRangeFromDates,
  type BookedDateEntry,
} from '@/lib/memberBookedDates'
import { CrewMemberBookedDaysCalendar } from '@/components/project/CrewMemberBookedDaysCalendar'
import { crewDisplayRole } from '@/lib/jobApplicationRole'

type Member = {
  id: string
  profile_id: string
  member_role: string
  scheduling_start_date?: string | null
  scheduling_end_date?: string | null
  booked_dates?: unknown
  contact_email?: string | null
  contact_phone?: string | null
  contact_label?: string | null
  works_as?: string | null
  profiles: {
    name: string | null
    avatar_url: string | null
    headline?: string | null
    email?: string | null
  } | null
}

type ManualCrew = {
  id: string
  project_id: string
  name: string
  member_role: string
  email: string | null
  phone: string | null
  booked_dates?: unknown
  scheduling_start_date?: string | null
  scheduling_end_date?: string | null
  day_rate_amount?: number | null
  half_day_rate_amount?: number | null
}

type CrewRow =
  | {
      source: 'registered'
      id: string
      profile_id: string
      member_role: string
      avatar_url: string | null
      name: string
      subtitle: string
      role_display?: string | null
      email: string | null
      phone: string | null
      scheduling_start_date?: string | null
      scheduling_end_date?: string | null
      contact_email?: string | null
      contact_phone?: string | null
      contact_label?: string | null
      /** Resolved shoot days (booked_dates or legacy scheduling range). */
      bookingDates: string[]
      bookingSlots: BookedDateEntry[]
    }
  | {
      source: 'manual'
      id: string
      member_role: string
      name: string
      subtitle: string
      role_display?: string | null
      email: string | null
      phone: string | null
      bookingDates: string[]
      bookingSlots: BookedDateEntry[]
      day_rate_amount: number | null
      half_day_rate_amount: number | null
    }

function parseOptionalRate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 100) / 100
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim().replace(',', '.'))
    if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100
  }
  return null
}

function rateToInput(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  return String(n)
}

type Props = {
  projectId: string
  canManage: boolean
  /** True when the signed-in user is the hiring company (`projects.company_id`). Used for shoot days + job contact fields. */
  viewerIsCompany: boolean
  /** Signed-in user id from parent (avoids race before auth effect in this tab). */
  viewerId?: string | null
  workspaceOnly?: boolean
  proFeaturesEnabled?: boolean
  /** Job production window (Overview); required to pick shoot days per freelancer. */
  productionWindowStart: string
  productionWindowEnd: string
}

const roleLabel = (r: string) => {
  if (r === 'company') return 'Client'
  if (r === 'lead') return 'Lead'
  return 'Crew'
}

function crewAvatarInitial(name: string | null | undefined) {
  const t = (name ?? '').trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}

function crewAvatarUri(raw: string | null | undefined): string | null {
  const u = (raw ?? '').trim()
  return u && /^https?:\/\//i.test(u) ? u : null
}

export function ProjectCrewTab({
  projectId,
  canManage,
  viewerIsCompany,
  viewerId: viewerIdProp,
  workspaceOnly = false,
  proFeaturesEnabled = true,
  productionWindowStart,
  productionWindowEnd,
}: Props) {
  const { height: windowHeight } = useWindowDimensions()
  const [rows, setRows] = useState<CrewRow[]>([])
  const [pendingInvites, setPendingInvites] = useState<ProjectCrewInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [crewSearch, setCrewSearch] = useState('')
  const [crewSearchResults, setCrewSearchResults] = useState<
    { id: string; name: string | null; avatar_url: string | null }[]
  >([])
  const [crewSearchLoading, setCrewSearchLoading] = useState(false)
  const [crewDropdownOpen, setCrewDropdownOpen] = useState(false)
  const crewBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [busy, setBusy] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualRole, setManualRole] = useState('')
  const [manualEmail, setManualEmail] = useState('')
  const [manualPhone, setManualPhone] = useState('')
  const [manualDayRate, setManualDayRate] = useState('')
  const [manualHalfDayRate, setManualHalfDayRate] = useState('')
  const [manualAddSlots, setManualAddSlots] = useState<BookedDateEntry[]>([])
  const [personModalOpen, setPersonModalOpen] = useState(false)
  const [selectedCrew, setSelectedCrew] = useState<CrewRow | null>(null)
  const [personName, setPersonName] = useState('')
  const [personRole, setPersonRole] = useState('crew')
  const [personEmail, setPersonEmail] = useState('')
  const [personPhone, setPersonPhone] = useState('')
  const [personDayRate, setPersonDayRate] = useState('')
  const [personHalfDayRate, setPersonHalfDayRate] = useState('')
  const [memberBookedDraftSlots, setMemberBookedDraftSlots] = useState<BookedDateEntry[]>([])
  const [shootDatesEditorOpen, setShootDatesEditorOpen] = useState(false)
  const [savingMemberSchedule, setSavingMemberSchedule] = useState(false)
  const [viewerUserId, setViewerUserId] = useState<string | null>(viewerIdProp ?? null)
  const effectiveViewerId = viewerIdProp ?? viewerUserId
  const [projectContactEmail, setProjectContactEmail] = useState('')
  const [projectContactPhone, setProjectContactPhone] = useState('')
  const [projectContactLabel, setProjectContactLabel] = useState('')

  useEffect(() => {
    if (viewerIdProp) {
      setViewerUserId(viewerIdProp)
      return
    }
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setViewerUserId(user?.id ?? null)
    })()
  }, [viewerIdProp])

  const load = useCallback(async () => {
    const { data: projRow } = await supabase.from('projects').select('job_id').eq('id', projectId).maybeSingle()
    const jobId = (projRow as { job_id?: string | null } | null)?.job_id?.trim() || ''
    let appliedRoleByProfile = new Map<string, string>()
    if (jobId) {
      const { data: appRows } = await supabase
        .from('job_applications')
        .select('freelancer_id, applied_role, status')
        .eq('job_id', jobId)
        .in('status', ['pending', 'accepted'])
      for (const row of appRows ?? []) {
        const fid = String((row as { freelancer_id?: string }).freelancer_id ?? '').trim()
        const ar = String((row as { applied_role?: string | null }).applied_role ?? '').trim()
        if (fid && ar) appliedRoleByProfile.set(fid, ar)
      }
    }

    const [registeredRes, manualRes] = await Promise.all([
      supabase
        .from('project_members')
        .select(
          'id, profile_id, member_role, scheduling_start_date, scheduling_end_date, booked_dates, contact_email, contact_phone, contact_label, works_as, profiles(name, avatar_url, headline, email)'
        )
        .eq('project_id', projectId)
        .order('member_role', { ascending: true }),
      supabase
        .from('project_manual_crew_readable')
        .select(
          'id, project_id, name, member_role, email, phone, booked_dates, scheduling_start_date, scheduling_end_date, day_rate_amount, half_day_rate_amount'
        )
        .eq('project_id', projectId)
        .order('created_at', { ascending: true }),
    ])

    if (registeredRes.error) {
      Alert.alert('Crew', registeredRes.error.message)
      setRows([])
      setLoading(false)
      return
    }

    // Prefer masked view (hides day rates for non-hosts). Fall back to base table if the view is unavailable.
    let manualData = manualRes.data as ManualCrew[] | null
    if (manualRes.error) {
      console.warn('[ProjectCrewTab] project_manual_crew_readable', manualRes.error.message)
      const fallback = await supabase
        .from('project_manual_crew')
        .select(
          'id, project_id, name, member_role, email, phone, booked_dates, scheduling_start_date, scheduling_end_date, day_rate_amount, half_day_rate_amount'
        )
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
      if (fallback.error) {
        console.warn('[ProjectCrewTab] project_manual_crew', fallback.error.message)
        manualData = []
      } else {
        manualData = (fallback.data as ManualCrew[]) ?? []
      }
    }

    const registered = ((registeredRes.data as unknown as Member[]) ?? []).map((m) => {
      const prof = m.profiles as
        | {
            name: string | null
            avatar_url: string | null
            headline?: string | null
            email?: string | null
          }
        | null
        | undefined
        | Array<{
            name: string | null
            avatar_url: string | null
            headline?: string | null
            email?: string | null
          }>
      const p = Array.isArray(prof) ? prof[0] : prof
      const sStart = m.scheduling_start_date
      const sEnd = m.scheduling_end_date
      const rawContactNote =
        typeof m.contact_label === 'string' && m.contact_label.trim()
          ? m.contact_label.trim()
          : ''
      const rl = roleLabel(m.member_role)
      const worksAs = typeof m.works_as === 'string' && m.works_as.trim() ? m.works_as.trim() : ''
      const appliedForJob = appliedRoleByProfile.get(m.profile_id) ?? ''
      const roleDisplay = crewDisplayRole(
        worksAs || appliedForJob,
        typeof p?.headline === 'string' && p.headline.trim().length > 0 ? p.headline.trim() : null,
        rl,
      )
      const subtitle =
        rawContactNote.length > 0
          ? `${roleDisplay} · ${rawContactNote.length > 38 ? `${rawContactNote.slice(0, 38)}…` : rawContactNote}`
          : roleDisplay
      const profileEmail =
        typeof p?.email === 'string' && p.email.trim().length > 0 ? p.email.trim() : null
      const bookingSlots = memberBookedSlotsFromRow(m)
      const bookingDates = calendarDatesFromSlots(bookingSlots)
      return {
        source: 'registered' as const,
        id: m.id,
        profile_id: m.profile_id,
        member_role: m.member_role,
        avatar_url: crewAvatarUri(p?.avatar_url),
        role_display: roleDisplay,
        name: p?.name || 'Member',
        subtitle,
        email: profileEmail,
        phone: null,
        contact_email: typeof m.contact_email === 'string' ? m.contact_email : null,
        contact_phone: typeof m.contact_phone === 'string' ? m.contact_phone : null,
        contact_label: typeof m.contact_label === 'string' ? m.contact_label : null,
        scheduling_start_date:
          typeof sStart === 'string' ? sStart.slice(0, 10) : sStart != null ? String(sStart).slice(0, 10) : null,
        scheduling_end_date:
          typeof sEnd === 'string' ? sEnd.slice(0, 10) : sEnd != null ? String(sEnd).slice(0, 10) : null,
        bookingDates,
        bookingSlots,
      }
    })

    const manual = (manualData ?? []).map((m) => {
      const role = (m.member_role || '').trim()
      const bookingSlots = memberBookedSlotsFromRow(m)
      const bookingDates = calendarDatesFromSlots(bookingSlots)
      // Day rates: host only (UI + masked view). Other crew still see name/role/contact/dates.
      const dayRate = viewerIsCompany ? parseOptionalRate(m.day_rate_amount) : null
      const rateNote = dayRate != null ? ` · €${dayRate}/day` : ''
      const shootNote = formatBookedSlotsSummary(bookingSlots)
      return {
        source: 'manual' as const,
        id: m.id,
        member_role: m.member_role || 'crew',
        role_display: role || 'Crew',
        name: m.name,
        subtitle: `${role || 'Crew'}${rateNote}${shootNote ? ` · ${shootNote}` : ''}`,
        email: m.email?.trim() || null,
        phone: m.phone?.trim() || null,
        bookingDates,
        bookingSlots,
        day_rate_amount: dayRate,
        half_day_rate_amount: viewerIsCompany ? parseOptionalRate(m.half_day_rate_amount) : null,
      }
    })

    setRows([...registered, ...manual])
    if (canManage) {
      setPendingInvites(await listProjectCrewInvites(projectId))
    } else {
      setPendingInvites([])
    }
    setLoading(false)
  }, [projectId, canManage, viewerIsCompany])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  useEffect(() => {
    if (!proFeaturesEnabled || !canManage) {
      setCrewSearchResults([])
      return
    }
    const q = crewSearch.trim()
    if (q.length < 2) {
      setCrewSearchResults([])
      setCrewSearchLoading(false)
      return
    }
    setCrewSearchLoading(true)
    const t = setTimeout(() => {
      void (async () => {
        const { data, error } = await supabase.rpc('search_freelancers_for_project_crew', {
          p_project_id: projectId,
          p_query: q,
        })
        setCrewSearchLoading(false)
        if (error) {
          setCrewSearchResults([])
          return
        }
        const list = (data ?? []) as { id: string; name: string | null; avatar_url: string | null }[]
        setCrewSearchResults(
          list.map((r) => ({
            id: r.id,
            name: r.name,
            avatar_url: r.avatar_url,
          }))
        )
      })()
    }, 320)
    return () => clearTimeout(t)
  }, [crewSearch, projectId, proFeaturesEnabled, canManage])

  const clearCrewBlurTimer = () => {
    if (crewBlurTimerRef.current) {
      clearTimeout(crewBlurTimerRef.current)
      crewBlurTimerRef.current = null
    }
  }

  const scheduleCloseCrewDropdown = () => {
    clearCrewBlurTimer()
    crewBlurTimerRef.current = setTimeout(() => setCrewDropdownOpen(false), 220)
  }

  const addByProfileId = async (profileId: string) => {
    if (!proFeaturesEnabled) {
      Alert.alert('Crew invite', 'Only available for Pro users.')
      return
    }
    if (busy) return
    clearCrewBlurTimer()
    setCrewDropdownOpen(false)
    setCrewSearch('')
    setCrewSearchResults([])
    setBusy(true)
    const { error } = await supabase.rpc('add_project_crew_by_profile_id', {
      p_project_id: projectId,
      p_profile_id: profileId,
    })
    setBusy(false)
    if (error) {
      Alert.alert('Could not add', error.message)
      return
    }
    void notifyExpoEvent({ kind: 'project_crew_invite', projectId, crewProfileId: profileId })
    load()
    Alert.alert('Invitation sent', "They'll get access to this project workspace once they accept the invite.")
  }

  const cancelInvite = (invite: ProjectCrewInvite) => {
    Alert.alert('Cancel invitation', `Cancel the invitation to ${invite.name}?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel invite',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id))
            const res = await cancelCrewInvite(invite.id)
            if (!res.ok) {
              Alert.alert('Could not cancel', res.error ?? 'Please try again.')
            }
            load()
          })()
        },
      },
    ])
  }

  const addManualCrew = async () => {
    if (busy) return
    if (!viewerIsCompany) {
      Alert.alert('Add crew', 'Only the project client can add external crew.')
      return
    }
    const name = manualName.trim()
    if (name.length < 2) {
      Alert.alert('Add crew', 'Please enter at least 2 characters for the name.')
      return
    }
    const memberRole = manualRole.trim() || 'crew'
    const mail = manualEmail.trim().toLowerCase()
    const phone = manualPhone.trim()
    const ws = productionWindowStart.trim().slice(0, 10)
    const we = productionWindowEnd.trim().slice(0, 10)
    const windowOk = /^\d{4}-\d{2}-\d{2}$/.test(ws) && /^\d{4}-\d{2}-\d{2}$/.test(we) && we >= ws
    if (manualAddSlots.length > 0 && !windowOk) {
      Alert.alert('Production window', 'Set the project production window on Overview first.')
      return
    }
    const clamped = windowOk ? clampBookedEntriesToWindow(manualAddSlots, ws, we) : []
    const payload = serializeBookedDateEntries(clamped)
    const { start, end } = syncSchedulingRangeFromDates(calendarDatesFromSlots(clamped))
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      Alert.alert('Add crew', 'Please sign in again.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('project_manual_crew').insert({
      project_id: projectId,
      name,
      member_role: memberRole,
      email: mail || null,
      phone: phone || null,
      created_by: user.id,
      day_rate_amount: parseOptionalRate(manualDayRate),
      half_day_rate_amount: parseOptionalRate(manualHalfDayRate),
      booked_dates: payload.length > 0 ? payload : null,
      scheduling_start_date: start,
      scheduling_end_date: end,
    })
    setBusy(false)
    if (error) {
      Alert.alert('Could not add', error.message)
      return
    }
    setManualName('')
    setManualRole('')
    setManualEmail('')
    setManualPhone('')
    setManualDayRate('')
    setManualHalfDayRate('')
    setManualAddSlots([])
    setModalOpen(false)
    load()
    Alert.alert('Added', 'Crew member was added to this project.')
  }

  const removeCrew = (m: CrewRow) => {
    if (m.member_role === 'company') {
      Alert.alert('Remove crew member', 'The client cannot be removed from the project.')
      return
    }
    Alert.alert('Remove crew member', 'They will lose access to this project.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } =
            m.source === 'manual'
              ? await supabase.from('project_manual_crew').delete().eq('id', m.id)
              : await supabase.from('project_members').delete().eq('id', m.id)
          if (error) {
            Alert.alert('Remove failed', error.message)
            return
          }
          load()
        },
      },
    ])
  }

  const openPersonCard = (m: CrewRow) => {
    setSelectedCrew(m)
    setPersonName(m.name)
    setPersonRole(m.member_role || 'crew')
    setPersonEmail((m.email ?? '').trim())
    setPersonPhone((m.phone ?? '').trim())
    if (m.source === 'registered') {
      setMemberBookedDraftSlots([...m.bookingSlots])
      setPersonDayRate('')
      setPersonHalfDayRate('')
      setProjectContactEmail((m.contact_email ?? '').trim() || (m.email ?? '').trim())
      setProjectContactPhone((m.contact_phone ?? '').trim())
      setProjectContactLabel((m.contact_label ?? '').trim())
    } else {
      setMemberBookedDraftSlots([...m.bookingSlots])
      setPersonDayRate(rateToInput(m.day_rate_amount))
      setPersonHalfDayRate(rateToInput(m.half_day_rate_amount))
      setProjectContactEmail('')
      setProjectContactPhone('')
      setProjectContactLabel('')
    }
    setPersonModalOpen(true)
    setShootDatesEditorOpen(false)
  }

  const canRemoveMember = (m: CrewRow | null) => {
    if (!m) return false
    return viewerIsCompany && m.member_role !== 'company'
  }

  /** Manual rows always; registered row only when this device user is that profile (e.g. client/company row = you). */
  const canEditOwnRegisteredRow =
    Boolean(
      selectedCrew?.source === 'registered' &&
        effectiveViewerId &&
        selectedCrew.profile_id === effectiveViewerId
    )

  /** Only the project host/client may edit manual (no Crea account) crew. */
  const canEditManualCrewFields = Boolean(selectedCrew?.source === 'manual' && viewerIsCompany)

  /** Hiring company: shoot days + job contact for other freelancers. Workspace: own row contact too. */
  const companyCanEditMemberJobFields = Boolean(
    viewerIsCompany &&
      selectedCrew?.source === 'registered' &&
      selectedCrew.member_role !== 'company'
  )

  /** Own row: contact for this project. Company: other freelancers’ job contact + shoot days. */
  const canEditProjectContactFields = Boolean(
    companyCanEditMemberJobFields || canEditOwnRegisteredRow
  )

  const canEditPersonFields = canEditManualCrewFields || canEditOwnRegisteredRow

  const canSavePersonModal =
    selectedCrew?.source === 'manual'
      ? canEditManualCrewFields
      : Boolean(companyCanEditMemberJobFields || canEditOwnRegisteredRow)

  /** Shoot days: host for registered freelancers + manual crew; lead/crew cannot edit manual dates. */
  const canEditSelectedShootDays = Boolean(
    selectedCrew &&
      viewerIsCompany &&
      ((selectedCrew.source === 'registered' && selectedCrew.member_role !== 'company') ||
        selectedCrew.source === 'manual')
  )

  const saveMemberProductionDates = async () => {
    if (!selectedCrew || !canEditSelectedShootDays) return
    if (selectedCrew.source === 'registered' && selectedCrew.member_role === 'company') return
    const ws = productionWindowStart.trim().slice(0, 10)
    const we = productionWindowEnd.trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ws) || !/^\d{4}-\d{2}-\d{2}$/.test(we)) {
      Alert.alert('Production window', 'Set the project production window on Overview first (start and end).')
      return
    }
    if (we < ws) {
      Alert.alert('Production window', 'End date must be on or after start.')
      return
    }
    const clamped = clampBookedEntriesToWindow(memberBookedDraftSlots, ws, we)
    const payload = serializeBookedDateEntries(clamped)
    const dateKeys = calendarDatesFromSlots(clamped)
    const { start, end } = syncSchedulingRangeFromDates(dateKeys)
    setSavingMemberSchedule(true)
    const table = selectedCrew.source === 'manual' ? 'project_manual_crew' : 'project_members'
    const { error } = await supabase
      .from(table)
      .update({
        booked_dates: payload.length > 0 ? payload : null,
        scheduling_start_date: start,
        scheduling_end_date: end,
      })
      .eq('id', selectedCrew.id)
    setSavingMemberSchedule(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    load()
    setShootDatesEditorOpen(false)
    Alert.alert(
      'Saved',
      selectedCrew.source === 'manual'
        ? 'Shoot days saved for this crew contact.'
        : 'Their public calendar shows busy only on these days when the project is active.'
    )
  }

  const clearMemberProductionDates = async () => {
    if (!selectedCrew || !canEditSelectedShootDays) return
    if (selectedCrew.source === 'registered' && selectedCrew.member_role === 'company') return
    setSavingMemberSchedule(true)
    const table = selectedCrew.source === 'manual' ? 'project_manual_crew' : 'project_members'
    const { error } = await supabase
      .from(table)
      .update({
        booked_dates: null,
        scheduling_start_date: null,
        scheduling_end_date: null,
      })
      .eq('id', selectedCrew.id)
    setSavingMemberSchedule(false)
    if (error) {
      Alert.alert('Clear failed', error.message)
      return
    }
    setMemberBookedDraftSlots([])
    load()
    Alert.alert('Cleared', 'Shoot days removed for this crew member.')
  }

  const savePersonInfo = async () => {
    if (!selectedCrew) return

    if (selectedCrew.source === 'manual') {
      if (!viewerIsCompany) {
        Alert.alert('Person info', 'Only the project client can edit external crew.')
        return
      }
      const nextName = personName.trim()
      if (nextName.length < 2) {
        Alert.alert('Person info', 'Please enter at least 2 characters for the name.')
        return
      }
      const nextRole = personRole.trim() || 'crew'
      const nextEmail = personEmail.trim().toLowerCase()
      const nextPhone = personPhone.trim()
      const ws = productionWindowStart.trim().slice(0, 10)
      const we = productionWindowEnd.trim().slice(0, 10)
      const windowOk = /^\d{4}-\d{2}-\d{2}$/.test(ws) && /^\d{4}-\d{2}-\d{2}$/.test(we) && we >= ws
      const clamped = windowOk
        ? clampBookedEntriesToWindow(memberBookedDraftSlots, ws, we)
        : memberBookedDraftSlots
      const payload = serializeBookedDateEntries(clamped)
      const { start, end } = syncSchedulingRangeFromDates(calendarDatesFromSlots(clamped))
      setBusy(true)
      const { error } = await supabase
        .from('project_manual_crew')
        .update({
          name: nextName,
          member_role: nextRole,
          email: nextEmail || null,
          phone: nextPhone || null,
          day_rate_amount: parseOptionalRate(personDayRate),
          half_day_rate_amount: parseOptionalRate(personHalfDayRate),
          booked_dates: payload.length > 0 ? payload : null,
          scheduling_start_date: start,
          scheduling_end_date: end,
        })
        .eq('id', selectedCrew.id)
      setBusy(false)
      if (error) {
        Alert.alert('Save failed', error.message)
        return
      }
      setPersonModalOpen(false)
      setSelectedCrew(null)
      load()
      Alert.alert('Saved', 'Crew contact, rates, and shoot days were updated.')
      return
    }

    if (!canEditOwnRegisteredRow && !canEditProjectContactFields) {
      Alert.alert('Person info', 'You cannot edit this entry.')
      return
    }

    if (canEditOwnRegisteredRow && effectiveViewerId) {
      const nextName = personName.trim()
      if (nextName.length < 2) {
        Alert.alert('Person info', 'Please enter at least 2 characters for the name.')
        return
      }
      setBusy(true)
      const { error: nameErr } = await supabase.from('profiles').update({ name: nextName }).eq('id', effectiveViewerId)
      setBusy(false)
      if (nameErr) {
        Alert.alert('Save failed', nameErr.message)
        return
      }
    }

    if (canEditProjectContactFields) {
      setBusy(true)
      const { error: pmErr } = await supabase
        .from('project_members')
        .update({
          contact_email: projectContactEmail.trim() || null,
          contact_phone: projectContactPhone.trim() || null,
          contact_label: projectContactLabel.trim() || null,
        })
        .eq('id', selectedCrew.id)
      setBusy(false)
      if (pmErr) {
        Alert.alert('Save failed', pmErr.message)
        return
      }
    }

    setPersonModalOpen(false)
    setSelectedCrew(null)
    load()
    Alert.alert('Saved', 'Updated.')
  }

  const callPerson = async () => {
    const raw = (
      selectedCrew?.source === 'registered' ? projectContactPhone : personPhone
    ).trim()
    if (!raw) {
      Alert.alert('Call', 'No phone number available.')
      return
    }
    const url = `tel:${raw.replace(/\s+/g, '')}`
    const canOpen = await Linking.canOpenURL(url)
    if (!canOpen) {
      Alert.alert('Call', 'Phone calls are not available on this device.')
      return
    }
    await Linking.openURL(url)
  }

  const emailPerson = async () => {
    const raw = (
      selectedCrew?.source === 'registered' ? projectContactEmail : personEmail
    ).trim()
    if (!raw) {
      Alert.alert('Email', 'No email address available.')
      return
    }
    const url = `mailto:${raw}`
    const canOpen = await Linking.canOpenURL(url)
    if (!canOpen) {
      Alert.alert('Email', 'Email is not available on this device.')
      return
    }
    await Linking.openURL(url)
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  return (
    <>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {canManage && (
        <>
          {workspaceOnly ? (
            viewerIsCompany ? (
              <>
                <Text style={styles.label}>Add crew</Text>
                <Text style={styles.hint}>
                  Workspace mode: add external crew manually without requiring a CREA account.
                </Text>
                <TouchableOpacity style={[styles.addBtnWide, busy && styles.dim]} onPress={() => setModalOpen(true)}>
                  <Text style={styles.addBtnText}>ADD CREW</Text>
                </TouchableOpacity>
              </>
            ) : null
          ) : (
            <>
              <Text style={styles.label}>Add crew</Text>
              <Text style={styles.hint}>
                {viewerIsCompany
                  ? 'Search freelancers on Crea by name, or add someone without an account (name, email, phone for your records).'
                  : 'Search freelancers on Crea by name to invite them to this project.'}
              </Text>
              {!workspaceOnly ? (
                <Text style={styles.hintTight}>
                  Need different production lengths per role? Tap a person below → set their production dates (public
                  calendar busy).
                </Text>
              ) : null}
              {!proFeaturesEnabled ? (
                <Text style={styles.proHint}>Only available for Pro users.</Text>
              ) : null}
              <View style={[styles.searchBlock, crewDropdownOpen && crewSearch.trim().length >= 2 && styles.searchBlockOpen]}>
                <View style={styles.inputWithSpinner}>
                  <TextInput
                    style={styles.crewSearchInput}
                    placeholder="Type a name…"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    value={crewSearch}
                    onChangeText={setCrewSearch}
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={proFeaturesEnabled}
                    onFocus={() => {
                      clearCrewBlurTimer()
                      setCrewDropdownOpen(true)
                    }}
                    onBlur={scheduleCloseCrewDropdown}
                  />
                  {crewSearchLoading && proFeaturesEnabled ? (
                    <ActivityIndicator style={styles.inputSpinner} color="#FFDC00" size="small" />
                  ) : null}
                </View>
                {proFeaturesEnabled && crewDropdownOpen && crewSearch.trim().length >= 2 ? (
                  <View style={styles.dropdown} pointerEvents="box-none">
                    {crewSearchResults.length === 0 && !crewSearchLoading ? (
                      <Text style={styles.dropdownEmpty}>No matches</Text>
                    ) : (
                      <ScrollView
                        style={styles.dropdownScroll}
                        keyboardShouldPersistTaps="handled"
                        nestedScrollEnabled
                        showsVerticalScrollIndicator={false}
                      >
                        {crewSearchResults.map((item) => {
                          const uri = crewAvatarUri(item.avatar_url)
                          const label = (item.name ?? '').trim() || 'Freelancer'
                          return (
                            <TouchableOpacity
                              key={item.id}
                              style={styles.dropdownRow}
                              activeOpacity={0.75}
                              onPressIn={clearCrewBlurTimer}
                              onPress={() => void addByProfileId(item.id)}
                            >
                              <View style={styles.dropdownAvatarWrap}>
                                {uri ? <Image source={{ uri }} style={styles.dropdownAvatar} /> : null}
                              </View>
                              <Text style={styles.dropdownName} numberOfLines={1}>
                                {label}
                              </Text>
                            </TouchableOpacity>
                          )
                        })}
                      </ScrollView>
                    )}
                  </View>
                ) : null}
              </View>
              {viewerIsCompany ? (
                <TouchableOpacity
                  style={[styles.addExternalBtn, (!proFeaturesEnabled || busy) && styles.dim]}
                  onPress={() => {
                    if (!proFeaturesEnabled) return
                    setModalOpen(true)
                  }}
                  disabled={!proFeaturesEnabled || busy}
                >
                  <Text style={styles.addExternalBtnText}>Add crew without a Crea account</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </>
      )}

      {canManage && pendingInvites.length > 0 ? (
        <>
          <Text style={styles.label}>Pending invitations</Text>
          {pendingInvites.map((inv) => {
            const uri = crewAvatarUri(inv.avatarUrl)
            return (
              <View key={inv.id} style={styles.inviteRow}>
                {uri ? (
                  <Image source={{ uri }} style={styles.rowAvatar} />
                ) : (
                  <View style={[styles.rowAvatar, styles.inviteAvatarPh]}>
                    <Text style={styles.inviteAvatarLetter}>{crewAvatarInitial(inv.name)}</Text>
                  </View>
                )}
                <View style={styles.rowText}>
                  <Text style={styles.name}>{inv.name}</Text>
                  <Text style={styles.invitePending}>Waiting for them to accept…</Text>
                </View>
                <TouchableOpacity
                  style={styles.inviteCancelBtn}
                  onPress={() => cancelInvite(inv)}
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel invitation to ${inv.name}`}
                >
                  <Text style={styles.inviteCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )
          })}
        </>
      ) : null}

      <Text style={styles.label}>People on this project</Text>
      {rows.map((m) => {
        const canSwipeDelete = canRemoveMember(m)
        const rowContent = (
          <View style={styles.row}>
            {m.source === 'registered' && m.avatar_url ? (
              <Image source={{ uri: m.avatar_url }} style={styles.rowAvatar} />
            ) : null}
            <TouchableOpacity style={styles.rowText} onPress={() => openPersonCard(m)}>
              <Text style={styles.name}>{m.name}</Text>
              <Text style={styles.role}>{m.subtitle}</Text>
              {m.source === 'registered' && formatBookedSlotsSummary(m.bookingSlots) ? (
                <Text style={styles.scheduleLine} numberOfLines={2}>
                  {formatBookedSlotsSummary(m.bookingSlots)}
                </Text>
              ) : null}
            </TouchableOpacity>
          </View>
        )
        if (!canSwipeDelete) {
          return (
            <View key={m.id}>
              {rowContent}
            </View>
          )
        }
        return (
          <Swipeable
            key={m.id}
            friction={2}
            overshootRight={false}
            renderRightActions={() => (
              <View style={styles.swipeDeleteOuter}>
                <TouchableOpacity
                  style={styles.swipeDeleteBtn}
                  onPress={() => removeCrew(m)}
                  accessibilityRole="button"
                  accessibilityLabel="Delete crew member"
                >
                  <Trash2 size={20} color="#fff" strokeWidth={ICON_STROKE} />
                  <Text style={styles.swipeDeleteLabel}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          >
            {rowContent}
          </Swipeable>
        )
      })}
    </ScrollView>

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: windowHeight * 0.9 }}
            contentContainerStyle={styles.modalScrollContent}
          >
            <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add crew (no Crea account)</Text>
            <Text style={styles.modalHint}>
              For people not on Crea yet. Set contact, day rate, and shoot days — same as Crea crew for budget.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Name"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={manualName}
              onChangeText={setManualName}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Role (e.g. Gaffer)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={manualRole}
              onChangeText={setManualRole}
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Email (optional)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={manualEmail}
              onChangeText={setManualEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Phone (optional)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={manualPhone}
              onChangeText={setManualPhone}
              keyboardType="phone-pad"
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Day rate € (optional)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={manualDayRate}
              onChangeText={setManualDayRate}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.modalInput}
              placeholder="Half-day rate € (optional)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={manualHalfDayRate}
              onChangeText={setManualHalfDayRate}
              keyboardType="decimal-pad"
            />
            <View style={styles.memberSchedBox}>
              <Text style={styles.modalSectionKicker}>Shoot / booking days</Text>
              {/^\d{4}-\d{2}-\d{2}$/.test(productionWindowStart.trim().slice(0, 10)) &&
              /^\d{4}-\d{2}-\d{2}$/.test(productionWindowEnd.trim().slice(0, 10)) ? (
                <>
                  <Text style={styles.bookedForSummaryText}>
                    {formatBookedSlotsSummary(manualAddSlots) ?? 'Not set yet'}
                  </Text>
                  <CrewMemberBookedDaysCalendar
                    productionWindowStart={productionWindowStart}
                    productionWindowEnd={productionWindowEnd}
                    bookedSlots={manualAddSlots}
                    disabled={busy}
                    hideInstructions
                    onCycleIso={(iso) => {
                      setManualAddSlots((prev) => cycleBookedDaySlot(prev, iso))
                    }}
                  />
                </>
              ) : (
                <Text style={styles.modalHintSmall}>
                  Set the production window on Overview first to assign shoot days.
                </Text>
              )}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => {
                  setModalOpen(false)
                  setManualAddSlots([])
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalSave, busy && styles.dim]} onPress={addManualCrew} disabled={busy}>
                <Text style={styles.modalSaveText}>{busy ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
      <Modal visible={personModalOpen} transparent animationType="fade" onRequestClose={() => setPersonModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: windowHeight * 0.92 }}
            contentContainerStyle={styles.modalScrollContent}
          >
            <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Person info</Text>
            <Text style={styles.modalHint}>
              {selectedCrew?.source === 'manual'
                ? viewerIsCompany
                  ? 'Edit contact, day rate, and shoot days for this crew member (no Crea account).'
                  : 'External crew (no Crea account). Contact and booked days are set by the project client.'
                : companyCanEditMemberJobFields
                  ? 'Shoot days and “On this project” are for this job only (hiring company). Your display name still updates your Crea profile when this card is you.'
                  : canEditOwnRegisteredRow
                    ? workspaceOnly
                      ? 'Update your display name and how you appear on this project’s crew list (contact email/phone for this project).'
                      : 'Your display name updates your Crea profile. Shoot days and job contact are set by the hiring company.'
                    : 'Shoot days and job contact can only be changed by the hiring company. Names come from each person’s Crea profile.'}
            </Text>

            {/* Manual crew — crew/freelancers: same read-only card as other members (no day rates, no edit). */}
            {selectedCrew?.source === 'manual' && !viewerIsCompany ? (
              <>
                {!workspaceOnly ? (
                  <View style={styles.memberSchedBox}>
                    <Text style={styles.modalSectionKicker}>Booked for</Text>
                    <Text style={styles.modalReadonlyValue}>
                      {formatBookedSlotsSummary(selectedCrew.bookingSlots) ?? 'Not set yet'}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.modalReadonlyBlock}>
                  <Text style={styles.modalReadonlyLabel}>Name</Text>
                  <Text style={styles.modalReadonlyValue}>{selectedCrew.name}</Text>
                </View>
                <View style={styles.modalReadonlyBlock}>
                  <Text style={styles.modalReadonlyLabel}>Role</Text>
                  <Text style={styles.modalReadonlyValue}>
                    {(selectedCrew.role_display ?? '').trim() || roleLabel(selectedCrew.member_role)}
                  </Text>
                </View>
                <View style={styles.projectContactSection}>
                  <Text style={styles.modalSectionKicker}>Contact</Text>
                  <View style={styles.modalReadonlyBlock}>
                    <Text style={styles.modalReadonlyLabel}>Email</Text>
                    <Text style={styles.modalReadonlyValue}>
                      {(selectedCrew.email ?? '').trim() || '—'}
                    </Text>
                  </View>
                  <View style={styles.modalReadonlyBlock}>
                    <Text style={styles.modalReadonlyLabel}>Phone</Text>
                    <Text style={styles.modalReadonlyValue}>
                      {(selectedCrew.phone ?? '').trim() || '—'}
                    </Text>
                  </View>
                </View>
              </>
            ) : null}

            {/* Manual crew — project owner only: full edit (dates, rates, contact). */}
            {selectedCrew?.source === 'manual' && viewerIsCompany ? (
              <>
                <View style={styles.memberSchedBox}>
                  <Text style={styles.modalSectionKicker}>Booked for</Text>
                  <TouchableOpacity
                    style={styles.bookedForExpandHeader}
                    onPress={() => setShootDatesEditorOpen((o) => !o)}
                    accessibilityRole="button"
                    accessibilityLabel={shootDatesEditorOpen ? 'Hide calendar' : 'Change shoot days'}
                  >
                    <Text style={styles.bookedForSummaryText}>
                      {formatBookedSlotsSummary(memberBookedDraftSlots) ?? 'Not set yet'}
                    </Text>
                    <ChevronDown
                      size={20}
                      color="rgba(255,255,255,0.55)"
                      strokeWidth={ICON_STROKE}
                      style={{
                        transform: [{ rotate: shootDatesEditorOpen ? '180deg' : '0deg' }],
                      }}
                    />
                  </TouchableOpacity>
                  {!shootDatesEditorOpen ? (
                    <Text style={styles.modalHintSmall}>
                      Tap to cycle days: off → full → half (within the production window).
                    </Text>
                  ) : (
                    <>
                      <CrewMemberBookedDaysCalendar
                        productionWindowStart={productionWindowStart}
                        productionWindowEnd={productionWindowEnd}
                        bookedSlots={memberBookedDraftSlots}
                        disabled={savingMemberSchedule || busy}
                        hideInstructions
                        onCycleIso={(iso) => {
                          setMemberBookedDraftSlots((prev) => cycleBookedDaySlot(prev, iso))
                        }}
                      />
                      <View style={styles.modalSchedActions}>
                        <TouchableOpacity
                          style={[styles.modalSave, (savingMemberSchedule || busy) && styles.dim]}
                          onPress={() => void saveMemberProductionDates()}
                          disabled={savingMemberSchedule || busy}
                        >
                          <Text style={styles.modalSaveText}>
                            {savingMemberSchedule ? 'Saving…' : 'Save shoot days'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.modalGhost}
                          onPress={() => void clearMemberProductionDates()}
                          disabled={savingMemberSchedule || busy}
                        >
                          <Text style={styles.modalGhostText}>Clear</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Name"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={personName}
                  onChangeText={setPersonName}
                />
                <TextInput
                  style={styles.modalInput}
                  placeholder="Role"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={personRole}
                  onChangeText={setPersonRole}
                />
                <TextInput
                  style={styles.modalInput}
                  placeholder="Email"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={personEmail}
                  onChangeText={setPersonEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <TextInput
                  style={styles.modalInput}
                  placeholder="Phone"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={personPhone}
                  onChangeText={setPersonPhone}
                  keyboardType="phone-pad"
                />
                <TextInput
                  style={styles.modalInput}
                  placeholder="Day rate €"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={personDayRate}
                  onChangeText={setPersonDayRate}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={styles.modalInput}
                  placeholder="Half-day rate € (optional)"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={personHalfDayRate}
                  onChangeText={setPersonHalfDayRate}
                  keyboardType="decimal-pad"
                />
              </>
            ) : null}

            {/* Registered Crea members */}
            {selectedCrew?.source === 'registered' ? (
              <>
                {selectedCrew.member_role !== 'company' && !workspaceOnly ? (
                  <View style={styles.memberSchedBox}>
                    <Text style={styles.modalSectionKicker}>Booked for</Text>
                    {canEditSelectedShootDays ? (
                      <>
                        <TouchableOpacity
                          style={styles.bookedForExpandHeader}
                          onPress={() => setShootDatesEditorOpen((o) => !o)}
                          accessibilityRole="button"
                          accessibilityLabel={shootDatesEditorOpen ? 'Hide calendar' : 'Change shoot days'}
                        >
                          <Text style={styles.bookedForSummaryText}>
                            {formatBookedSlotsSummary(memberBookedDraftSlots) ?? 'Not set yet'}
                          </Text>
                          <ChevronDown
                            size={20}
                            color="rgba(255,255,255,0.55)"
                            strokeWidth={ICON_STROKE}
                            style={{
                              transform: [{ rotate: shootDatesEditorOpen ? '180deg' : '0deg' }],
                            }}
                          />
                        </TouchableOpacity>
                        {!shootDatesEditorOpen ? (
                          <Text style={styles.modalHintSmall}>
                            Tap to cycle days: off → full → half (within the production window).
                          </Text>
                        ) : (
                          <>
                            <CrewMemberBookedDaysCalendar
                              productionWindowStart={productionWindowStart}
                              productionWindowEnd={productionWindowEnd}
                              bookedSlots={memberBookedDraftSlots}
                              disabled={savingMemberSchedule || busy}
                              hideInstructions
                              onCycleIso={(iso) => {
                                setMemberBookedDraftSlots((prev) => cycleBookedDaySlot(prev, iso))
                              }}
                            />
                            <View style={styles.modalSchedActions}>
                              <TouchableOpacity
                                style={[styles.modalSave, (savingMemberSchedule || busy) && styles.dim]}
                                onPress={() => void saveMemberProductionDates()}
                                disabled={savingMemberSchedule || busy}
                              >
                                <Text style={styles.modalSaveText}>
                                  {savingMemberSchedule ? 'Saving…' : 'Save shoot days'}
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.modalGhost}
                                onPress={() => void clearMemberProductionDates()}
                                disabled={savingMemberSchedule || busy}
                              >
                                <Text style={styles.modalGhostText}>Clear</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        )}
                      </>
                    ) : (
                      <Text style={styles.modalReadonlyValue}>
                        {formatBookedSlotsSummary(selectedCrew.bookingSlots) ?? 'Not set yet'}
                      </Text>
                    )}
                  </View>
                ) : null}
                <TextInput
                  style={[styles.modalInput, !canEditPersonFields && styles.modalInputLocked]}
                  placeholder="Name"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={personName}
                  onChangeText={setPersonName}
                  editable={canEditPersonFields}
                />
                <View style={styles.modalReadonlyBlock}>
                  <Text style={styles.modalReadonlyLabel}>Role</Text>
                  <Text style={styles.modalReadonlyValue}>
                    {(selectedCrew.role_display ?? '').trim() || roleLabel(selectedCrew.member_role)}
                  </Text>
                </View>
                <View style={styles.projectContactSection}>
                  <Text style={styles.modalSectionKicker}>On this project</Text>
                  <Text style={styles.modalHintSmall}>
                    Who is the contact for this job (e.g. producer on set)? Optional — only stored for this listing.
                  </Text>
                  <TextInput
                    style={[
                      styles.modalInput,
                      styles.modalInputMultiline,
                      !canEditProjectContactFields && styles.modalInputLocked,
                    ]}
                    placeholder="Contact person / note for crew…"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={projectContactLabel}
                    onChangeText={setProjectContactLabel}
                    multiline
                    textAlignVertical="top"
                    editable={canEditProjectContactFields}
                  />
                  <TextInput
                    style={[styles.modalInput, !canEditProjectContactFields && styles.modalInputLocked]}
                    placeholder="Email for this job"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={projectContactEmail}
                    onChangeText={setProjectContactEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    editable={canEditProjectContactFields}
                  />
                  <TextInput
                    style={[styles.modalInput, !canEditProjectContactFields && styles.modalInputLocked]}
                    placeholder="Phone for this job"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    value={projectContactPhone}
                    onChangeText={setProjectContactPhone}
                    keyboardType="phone-pad"
                    editable={canEditProjectContactFields}
                  />
                </View>
              </>
            ) : null}
            <View style={styles.contactActions}>
              <TouchableOpacity style={styles.contactBtn} onPress={callPerson}>
                <Text style={styles.contactBtnText}>Call</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.contactBtn} onPress={emailPerson}>
                <Text style={styles.contactBtnText}>Email</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setPersonModalOpen(false)}>
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
              {canRemoveMember(selectedCrew) ? (
                <TouchableOpacity
                  style={styles.modalDelete}
                  onPress={() => {
                    if (!selectedCrew) return
                    setPersonModalOpen(false)
                    removeCrew(selectedCrew)
                  }}
                >
                  <Text style={styles.modalDeleteText}>Remove member</Text>
                </TouchableOpacity>
              ) : null}
              {canSavePersonModal ? (
                <TouchableOpacity style={[styles.modalSave, busy && styles.dim]} onPress={savePersonInfo} disabled={busy}>
                  <Text style={styles.modalSaveText}>{busy ? 'Saving…' : 'Save changes'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: 32 },
  center: { paddingVertical: 40, alignItems: 'center' },
  label: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 8,
  },
  hint: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 12 },
  hintTight: { fontSize: 12, color: 'rgba(255,255,255,0.32)', marginBottom: 14, lineHeight: 17 },
  proHint: { fontSize: 12, color: '#FFDC00', marginBottom: 10, fontWeight: '700' },
  searchBlock: { marginBottom: 12, position: 'relative', zIndex: 20 },
  searchBlockOpen: { marginBottom: 8 },
  inputWithSpinner: { position: 'relative', width: '100%' },
  crewSearchInput: {
    width: '100%',
    minHeight: 48,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingRight: 40,
    color: '#fff',
    fontSize: 15,
  },
  inputSpinner: { position: 'absolute', right: 14, top: '50%', marginTop: -10 },
  dropdown: {
    marginTop: 6,
    maxHeight: 220,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    elevation: 10,
  },
  dropdownScroll: { maxHeight: 220 },
  dropdownEmpty: { paddingVertical: 14, paddingHorizontal: 12, fontSize: 13, color: 'rgba(255,255,255,0.45)' },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  dropdownAvatarWrap: { width: 36, height: 36 },
  dropdownAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#222' },
  dropdownAvatarPh: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownAvatarLetter: { color: '#fff', fontSize: 14, fontWeight: '700' },
  dropdownName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#fff' },
  addExternalBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginBottom: 24,
  },
  addExternalBtnText: { color: 'rgba(255,255,255,0.85)', fontWeight: '700', fontSize: 14 },
  input: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  addBtn: {
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { fontWeight: '800', color: '#0a0a0a', fontSize: 15 },
  addBtnWide: {
    borderRadius: 12,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginBottom: 24,
  },
  dim: { opacity: 0.5 },
  rowAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12, backgroundColor: '#222' },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  inviteAvatarPh: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,220,0,0.12)' },
  inviteAvatarLetter: { color: '#FFDC00', fontSize: 16, fontWeight: '800' },
  invitePending: { fontSize: 12, color: 'rgba(255,220,0,0.7)', marginTop: 2, fontWeight: '600' },
  inviteCancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  inviteCancelText: { color: 'rgba(255,255,255,0.75)', fontWeight: '700', fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: '#fff' },
  role: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 },
  scheduleLine: {
    fontSize: 11,
    color: 'rgba(255,220,0,0.75)',
    marginTop: 6,
    fontWeight: '600',
    lineHeight: 15,
  },
  swipeDeleteOuter: {
    width: 86,
    justifyContent: 'center',
  },
  swipeDeleteBtn: {
    flex: 1,
    backgroundColor: '#b91c1c',
    borderRadius: 12,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeDeleteLabel: { color: '#fff', fontSize: 12, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 20,
  },
  modalCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 6 },
  modalHint: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 14 },
  memberSchedBox: {
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  modalSectionKicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  bookedForExpandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 6,
    marginBottom: 4,
  },
  bookedForSummaryText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#FFDC00',
    lineHeight: 20,
  },
  modalHintSmall: { fontSize: 11, color: 'rgba(255,255,255,0.38)', marginBottom: 10, lineHeight: 16 },
  modalSchedActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 4 },
  modalGhost: { paddingVertical: 10, paddingHorizontal: 12 },
  modalGhostText: { color: 'rgba(255,255,255,0.45)', fontWeight: '700', fontSize: 13 },
  modalInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#fff',
    fontSize: 14,
    marginBottom: 10,
  },
  modalReadonlyBlock: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  modalReadonlyLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.38)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  modalReadonlyValue: { fontSize: 14, color: 'rgba(255,255,255,0.88)', fontWeight: '600' },
  projectContactSection: {
    marginTop: 6,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    marginBottom: 4,
  },
  modalInputMultiline: { minHeight: 72, paddingTop: 10 },
  modalInputLocked: { opacity: 0.65 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  modalCancel: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  modalCancelText: { color: 'rgba(255,255,255,0.75)', fontWeight: '700' },
  modalSave: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FFDC00',
  },
  modalSaveText: { color: '#0a0a0a', fontWeight: '800' },
  modalDelete: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#b91c1c',
    backgroundColor: 'rgba(185,28,28,0.15)',
  },
  modalDeleteText: { color: '#fecaca', fontWeight: '700' },
  contactActions: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  contactBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
  },
  contactBtnText: { color: '#fff', fontWeight: '700' },
})
