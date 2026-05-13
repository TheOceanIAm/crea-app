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
import { ICON_STROKE } from '@/lib/iconTheme'
import {
  clampDatesToWindow,
  formatBookedDaysSummary,
  memberBookedDatesFromRow,
  syncSchedulingRangeFromDates,
} from '@/lib/memberBookedDates'
import { CrewMemberBookedDaysCalendar } from '@/components/project/CrewMemberBookedDaysCalendar'

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
}

type CrewRow =
  | {
      source: 'registered'
      id: string
      profile_id: string
      member_role: string
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
    }

type Props = {
  projectId: string
  canManage: boolean
  /** True when the signed-in user is the hiring company (`projects.company_id`). Used for shoot days + job contact fields. */
  viewerIsCompany: boolean
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
  workspaceOnly = false,
  proFeaturesEnabled = true,
  productionWindowStart,
  productionWindowEnd,
}: Props) {
  const { height: windowHeight } = useWindowDimensions()
  const [rows, setRows] = useState<CrewRow[]>([])
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
  const [personModalOpen, setPersonModalOpen] = useState(false)
  const [selectedCrew, setSelectedCrew] = useState<CrewRow | null>(null)
  const [personName, setPersonName] = useState('')
  const [personRole, setPersonRole] = useState('crew')
  const [personEmail, setPersonEmail] = useState('')
  const [personPhone, setPersonPhone] = useState('')
  const [memberBookedDraftDates, setMemberBookedDraftDates] = useState<string[]>([])
  const [shootDatesEditorOpen, setShootDatesEditorOpen] = useState(false)
  const [savingMemberSchedule, setSavingMemberSchedule] = useState(false)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [projectContactEmail, setProjectContactEmail] = useState('')
  const [projectContactPhone, setProjectContactPhone] = useState('')
  const [projectContactLabel, setProjectContactLabel] = useState('')

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setViewerUserId(user?.id ?? null)
    })()
  }, [])

  const load = useCallback(async () => {
    const [registeredRes, manualRes] = await Promise.all([
      supabase
        .from('project_members')
        .select(
          'id, profile_id, member_role, scheduling_start_date, scheduling_end_date, booked_dates, contact_email, contact_phone, contact_label, profiles(name, avatar_url, headline, email)'
        )
        .eq('project_id', projectId)
        .order('member_role', { ascending: true }),
      supabase
        .from('project_manual_crew')
        .select('id, project_id, name, member_role, email, phone')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true }),
    ])

    if (registeredRes.error) {
      Alert.alert('Crew', registeredRes.error.message)
      setRows([])
      setLoading(false)
      return
    }
    if (manualRes.error) {
      Alert.alert('Crew', manualRes.error.message)
      setRows([])
      setLoading(false)
      return
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
      const roleDisplay =
        typeof p?.headline === 'string' && p.headline.trim().length > 0 ? p.headline.trim() : rl
      const subtitle =
        rawContactNote.length > 0
          ? `${roleDisplay} · ${rawContactNote.length > 38 ? `${rawContactNote.slice(0, 38)}…` : rawContactNote}`
          : roleDisplay
      const profileEmail =
        typeof p?.email === 'string' && p.email.trim().length > 0 ? p.email.trim() : null
      const bookingDates = memberBookedDatesFromRow(m)
      return {
        source: 'registered' as const,
        id: m.id,
        profile_id: m.profile_id,
        member_role: m.member_role,
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
      }
    })

    const manual = ((manualRes.data as ManualCrew[]) ?? []).map((m) => {
      const role = (m.member_role || '').trim()
      return {
        source: 'manual' as const,
        id: m.id,
        member_role: m.member_role || 'crew',
        role_display: role || 'Crew',
        name: m.name,
        subtitle: role || 'Crew',
        email: m.email?.trim() || null,
        phone: m.phone?.trim() || null,
      }
    })

    setRows([...registered, ...manual])
    setLoading(false)
  }, [projectId])

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
    Alert.alert('Added', 'They now have access to this project workspace.')
  }

  const addManualCrew = async () => {
    if (busy) return
    const name = manualName.trim()
    if (name.length < 2) {
      Alert.alert('Add crew', 'Please enter at least 2 characters for the name.')
      return
    }
    const memberRole = manualRole.trim() || 'crew'
    const mail = manualEmail.trim().toLowerCase()
    const phone = manualPhone.trim()
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
      setMemberBookedDraftDates([...m.bookingDates])
      setProjectContactEmail((m.contact_email ?? '').trim() || (m.email ?? '').trim())
      setProjectContactPhone((m.contact_phone ?? '').trim())
      setProjectContactLabel((m.contact_label ?? '').trim())
    } else {
      setMemberBookedDraftDates([])
      setProjectContactEmail('')
      setProjectContactPhone('')
      setProjectContactLabel('')
    }
    setPersonModalOpen(true)
    setShootDatesEditorOpen(false)
  }

  const canRemoveMember = (m: CrewRow | null) => {
    if (!m) return false
    return canManage && m.member_role !== 'company'
  }

  /** Manual rows always; registered row only when this device user is that profile (e.g. client/company row = you). */
  const canEditOwnRegisteredRow =
    Boolean(
      selectedCrew?.source === 'registered' &&
        viewerUserId &&
        selectedCrew.profile_id === viewerUserId
    )
  const canEditPersonFields = selectedCrew?.source === 'manual' || canEditOwnRegisteredRow

  /** Hiring company only: shoot days + project_members contact fields for freelancers (not leads). */
  const companyCanEditMemberJobFields = Boolean(
    viewerIsCompany &&
      selectedCrew?.source === 'registered' &&
      selectedCrew.member_role !== 'company'
  )

  const canSavePersonModal =
    selectedCrew?.source === 'manual'
      ? canEditPersonFields
      : Boolean(companyCanEditMemberJobFields || canEditOwnRegisteredRow)

  const saveMemberProductionDates = async () => {
    if (
      !viewerIsCompany ||
      !selectedCrew ||
      selectedCrew.source !== 'registered' ||
      selectedCrew.member_role === 'company'
    )
      return
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
    const dates = clampDatesToWindow(memberBookedDraftDates, ws, we)
    const { start, end } = syncSchedulingRangeFromDates(dates)
    setSavingMemberSchedule(true)
    const { error } = await supabase
      .from('project_members')
      .update({
        booked_dates: dates.length > 0 ? dates : null,
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
    Alert.alert('Saved', 'Their public calendar shows busy only on these days when the project is active.')
  }

  const clearMemberProductionDates = async () => {
    if (
      !viewerIsCompany ||
      !selectedCrew ||
      selectedCrew.source !== 'registered' ||
      selectedCrew.member_role === 'company'
    )
      return
    setSavingMemberSchedule(true)
    const { error } = await supabase
      .from('project_members')
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
    setMemberBookedDraftDates([])
    load()
    Alert.alert('Cleared', 'Shoot days removed for this crew member.')
  }

  const savePersonInfo = async () => {
    if (!selectedCrew) return

    if (selectedCrew.source === 'manual') {
      const nextName = personName.trim()
      if (nextName.length < 2) {
        Alert.alert('Person info', 'Please enter at least 2 characters for the name.')
        return
      }
      const nextRole = personRole.trim() || 'crew'
      const nextEmail = personEmail.trim().toLowerCase()
      const nextPhone = personPhone.trim()
      setBusy(true)
      const { error } = await supabase
        .from('project_manual_crew')
        .update({
          name: nextName,
          member_role: nextRole,
          email: nextEmail || null,
          phone: nextPhone || null,
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
      Alert.alert('Saved', 'Crew contact info was updated.')
      return
    }

    if (!canEditOwnRegisteredRow && !companyCanEditMemberJobFields) {
      Alert.alert('Person info', 'You cannot edit this entry.')
      return
    }

    if (canEditOwnRegisteredRow && viewerUserId) {
      const nextName = personName.trim()
      if (nextName.length < 2) {
        Alert.alert('Person info', 'Please enter at least 2 characters for the name.')
        return
      }
      setBusy(true)
      const { error: nameErr } = await supabase.from('profiles').update({ name: nextName }).eq('id', viewerUserId)
      setBusy(false)
      if (nameErr) {
        Alert.alert('Save failed', nameErr.message)
        return
      }
    }

    if (companyCanEditMemberJobFields) {
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
            <>
              <Text style={styles.label}>Add crew</Text>
              <Text style={styles.hint}>Workspace mode: add external crew manually without requiring a CREA account.</Text>
              <TouchableOpacity style={[styles.addBtnWide, busy && styles.dim]} onPress={() => setModalOpen(true)}>
                <Text style={styles.addBtnText}>ADD CREW</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>Add crew</Text>
              <Text style={styles.hint}>
                Search freelancers on Crea by name, or add someone without an account (name, email, phone for your
                records).
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
                                {uri ? (
                                  <Image source={{ uri }} style={styles.dropdownAvatar} />
                                ) : (
                                  <View style={styles.dropdownAvatarPh}>
                                    <Text style={styles.dropdownAvatarLetter}>{crewAvatarInitial(item.name)}</Text>
                                  </View>
                                )}
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
            </>
          )}
        </>
      )}

      <Text style={styles.label}>People on this project</Text>
      {rows.map((m) => {
        const canSwipeDelete = canRemoveMember(m)
        const rowContent = (
          <View style={styles.row}>
            <TouchableOpacity style={styles.rowText} onPress={() => openPersonCard(m)}>
              <Text style={styles.name}>{m.name}</Text>
              <Text style={styles.role}>{m.subtitle}</Text>
              {m.source === 'registered' && formatBookedDaysSummary(m.bookingDates) ? (
                <Text style={styles.scheduleLine} numberOfLines={2}>
                  {formatBookedDaysSummary(m.bookingDates)}
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
              For people not on Crea yet. Name and role are shown on the crew list; email and phone are stored so you can
              reach them outside the app.
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
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setModalOpen(false)}>
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
                ? 'Edit contact details for this crew member.'
                : companyCanEditMemberJobFields
                  ? 'Shoot days and “On this project” are for this job only (hiring company). Your display name still updates your Crea profile when this card is you.'
                  : canEditOwnRegisteredRow
                    ? 'Your display name updates your Crea profile. Shoot days and job contact are set by the hiring company.'
                    : 'Shoot days and job contact can only be changed by the hiring company. Names come from each person’s Crea profile.'}
            </Text>
            {selectedCrew?.source === 'registered' &&
            selectedCrew.member_role !== 'company' &&
            !workspaceOnly ? (
              <View style={styles.memberSchedBox}>
                <Text style={styles.modalSectionKicker}>Booked for</Text>
                {companyCanEditMemberJobFields ? (
                  <>
                    <TouchableOpacity
                      style={styles.bookedForExpandHeader}
                      onPress={() => setShootDatesEditorOpen((o) => !o)}
                      accessibilityRole="button"
                      accessibilityLabel={shootDatesEditorOpen ? 'Hide calendar' : 'Change shoot days'}
                    >
                      <Text style={styles.bookedForSummaryText}>
                        {formatBookedDaysSummary(memberBookedDraftDates) ?? 'Not set yet'}
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
                        Tap to pick days inside the production window (Overview). Only the hiring company can change this.
                      </Text>
                    ) : (
                      <>
                        <CrewMemberBookedDaysCalendar
                          productionWindowStart={productionWindowStart}
                          productionWindowEnd={productionWindowEnd}
                          selectedDates={memberBookedDraftDates}
                          disabled={savingMemberSchedule || busy}
                          hideInstructions
                          onToggleIso={(iso) => {
                            setMemberBookedDraftDates((prev) => {
                              const next = new Set(prev)
                              if (next.has(iso)) next.delete(iso)
                              else next.add(iso)
                              return [...next].sort()
                            })
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
                    {formatBookedDaysSummary(selectedCrew.bookingDates) ?? 'Not set yet'}
                  </Text>
                )}
              </View>
            ) : null}
            <TextInput
              style={styles.modalInput}
              placeholder="Name"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={personName}
              onChangeText={setPersonName}
              editable={canEditPersonFields}
            />
            {selectedCrew?.source === 'manual' ? (
              <TextInput
                style={styles.modalInput}
                placeholder="Role"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={personRole}
                onChangeText={setPersonRole}
              />
            ) : selectedCrew ? (
              <View style={styles.modalReadonlyBlock}>
                <Text style={styles.modalReadonlyLabel}>Role</Text>
                <Text style={styles.modalReadonlyValue}>
                  {(selectedCrew.role_display ?? '').trim() || roleLabel(selectedCrew.member_role)}
                </Text>
              </View>
            ) : null}
            {selectedCrew?.source === 'manual' ? (
              <>
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
              </>
            ) : selectedCrew ? (
              <View style={styles.projectContactSection}>
                <Text style={styles.modalSectionKicker}>On this project</Text>
                <Text style={styles.modalHintSmall}>
                  Who is the contact for this job (e.g. producer on set)? Optional — only stored for this listing.
                </Text>
                <TextInput
                  style={[
                    styles.modalInput,
                    styles.modalInputMultiline,
                    !companyCanEditMemberJobFields && styles.modalInputLocked,
                  ]}
                  placeholder="Contact person / note for crew…"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={projectContactLabel}
                  onChangeText={setProjectContactLabel}
                  multiline
                  textAlignVertical="top"
                  editable={companyCanEditMemberJobFields}
                />
                <TextInput
                  style={[styles.modalInput, !companyCanEditMemberJobFields && styles.modalInputLocked]}
                  placeholder="Email for this job"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={projectContactEmail}
                  onChangeText={setProjectContactEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  editable={companyCanEditMemberJobFields}
                />
                <TextInput
                  style={[styles.modalInput, !companyCanEditMemberJobFields && styles.modalInputLocked]}
                  placeholder="Phone for this job"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={projectContactPhone}
                  onChangeText={setProjectContactPhone}
                  keyboardType="phone-pad"
                  editable={companyCanEditMemberJobFields}
                />
              </View>
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
