import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { ChevronDown, X } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { sendAvailabilityProjectInvite } from '@/lib/sendAvailabilityProjectInvite'
import { money, toMoneyNumber } from '@/lib/invoiceFormatting'
import { sortIsoDates } from '@/lib/availabilityBookingSelection'

type InviteTarget = { id: string; title: string; kind: 'project' | 'job' }

function formatBookingCaps(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    .toUpperCase()
}

type Props = {
  visible: boolean
  onClose: () => void
  companyUserId: string
  freelancerId: string
  freelancerName: string
  freelancerAvatarUrl: string | null
  freelancerLetter: string
  dayRateAmount: unknown
  ratesCurrency: string | null
  selectedIsos: ReadonlySet<string>
  onInviteSent: (conversationId: string) => void
  /** Company accounts always true; freelancer leads need Pro or Workspace to create a private project row. */
  canCreatePrivateProject?: boolean
}

export function BookFreelancerModal({
  visible,
  onClose,
  companyUserId,
  freelancerId,
  freelancerName,
  freelancerAvatarUrl,
  freelancerLetter,
  dayRateAmount,
  ratesCurrency,
  selectedIsos,
  onInviteSent,
  canCreatePrivateProject = true,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [targets, setTargets] = useState<InviteTarget[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<InviteTarget | null>(null)
  const [message, setMessage] = useState('')

  const sorted = useMemo(() => sortIsoDates(selectedIsos), [selectedIsos])
  const fromIso = sorted[0] ?? ''
  const toIso = sorted[sorted.length - 1] ?? ''
  const dayCount = sorted.length
  const rateNum = toMoneyNumber(dayRateAmount)
  const cur = ratesCurrency ?? 'EUR'
  const rateRightLabel =
    rateNum != null && rateNum > 0 ? `${money(rateNum, cur)} / day` : 'RATE TBD'
  const totalEst =
    rateNum != null && rateNum > 0 && dayCount > 0 ? toMoneyNumber(rateNum * dayCount) : null

  const showAvatar = Boolean(freelancerAvatarUrl && /^https?:\/\//i.test(freelancerAvatarUrl.trim()))

  const loadTargets = useCallback(async () => {
    setLoadError(null)
    setLoading(true)
    const [{ data: projectRows, error: projectErr }, { data: jobRows, error: jobsErr }] = await Promise.all([
      supabase
      .from('projects')
      .select('id, title')
      .eq('company_id', companyUserId)
      .eq('freelancer_id', freelancerId)
      .order('updated_at', { ascending: false }),
      supabase
      .from('jobs')
      .select('id, title')
      .eq('company_id', companyUserId)
      .order('updated_at', { ascending: false }),
    ])

    if (projectErr) {
      setLoadError(projectErr.message)
    }

    if (jobsErr && !projectErr) {
      setLoadError(jobsErr.message)
    }

    const mappedProjects: InviteTarget[] = (projectRows ?? []).map((r) => ({
      id: String(r.id),
      title: String(r.title ?? '').trim() || 'Untitled project',
      kind: 'project',
    }))
    const mappedJobs: InviteTarget[] = (jobRows ?? []).map((r) => ({
      id: String(r.id),
      title: String(r.title ?? '').trim() || 'Untitled job',
      kind: 'job',
    }))
    const merged = [...mappedProjects, ...mappedJobs]
    const deduped: InviteTarget[] = []
    const seen = new Set<string>()
    for (const row of merged) {
      const key = `${row.kind}:${row.id}`
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(row)
    }

    setTargets(deduped)
    setSelectedTarget((prev) => {
      if (prev && deduped.some((x) => x.id === prev.id && x.kind === prev.kind)) return prev
      return deduped[0] ?? null
    })
    setLoading(false)
  }, [companyUserId, freelancerId])

  useEffect(() => {
    if (!visible) {
      setMessage('')
      setProjectPickerOpen(false)
      return
    }
    void loadTargets()
  }, [visible, loadTargets])

  const onSend = async () => {
    if (!selectedTarget || sending || sorted.length === 0) return
    setSending(true)
    setLoadError(null)
    const userMsg = message.trim()
    const openDeepLink =
      selectedTarget.kind === 'job'
        ? `crea://jobs/${selectedTarget.id}`
        : `crea://project/${selectedTarget.id}`
    const r = await sendAvailabilityProjectInvite({
      freelancerId,
      projectId: selectedTarget.id,
      projectTitle: selectedTarget.title,
      openDeepLink,
      isoStartDate: fromIso,
      isoEndDate: toIso,
      selectedIsoDates: sorted,
      userMessage: userMsg || undefined,
    })
    setSending(false)
    if (r.ok) {
      onInviteSent(r.conversationId)
      onClose()
    } else {
      setLoadError('error' in r ? r.error : 'Could not send booking request')
    }
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdropHit} onPress={onClose} />
        <KeyboardAvoidingView
          style={styles.centerBox}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
        >
          <View style={styles.card}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.cardScroll}
            >
          <View style={styles.headerRow}>
            {showAvatar ? (
              <Image source={{ uri: freelancerAvatarUrl!.trim() }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarRing}>
                <Text style={styles.avatarLetter}>{freelancerLetter}</Text>
              </View>
            )}
            <View style={styles.headerTextCol}>
              <Text style={styles.kicker}>BOOK FREELANCER</Text>
              <Text style={styles.nameSub}>{freelancerName.trim() || 'Freelancer'}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={14} accessibilityLabel="Close">
              <X size={22} color="rgba(255,255,255,0.45)" strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          </View>

          <View style={styles.dateBox}>
            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <Text style={styles.fromToLbl}>FROM</Text>
                <Text style={styles.dateBig}>{fromIso ? formatBookingCaps(fromIso) : '—'}</Text>
              </View>
              <Text style={styles.arrow}>→</Text>
              <View style={styles.dateCol}>
                <Text style={styles.fromToLbl}>TO</Text>
                <Text style={styles.dateBig}>{toIso ? formatBookingCaps(toIso) : '—'}</Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.dayCountLbl}>
                {dayCount} day{dayCount === 1 ? '' : 's'}
                {sorted.length > 1 && fromIso !== toIso ? ' (range)' : ''}
              </Text>
              <Text style={styles.rateLbl}>{rateRightLabel}</Text>
            </View>
            {totalEst != null && totalEst > 0 && dayCount > 1 ? (
              <Text style={styles.totalEst}>≈ {money(totalEst, cur)} total ({dayCount} × day rate)</Text>
            ) : null}
          </View>

          <Text style={styles.fieldLbl}>PROJECT</Text>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#FFDC00" />
            </View>
          ) : targets.length === 0 ? (
            <View style={styles.emptyProj}>
              <Text style={styles.emptyProjText}>
                No project found on your company account yet. Create one first, then invite this freelancer here.
              </Text>
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={styles.selectShell}
                onPress={() => setProjectPickerOpen((o) => !o)}
                activeOpacity={0.85}
              >
                <Text style={styles.selectText} numberOfLines={1}>
                  {selectedTarget
                    ? `${selectedTarget.kind === 'job' ? 'Project (Job Pool)' : 'Project'} · ${selectedTarget.title}`
                    : 'Select a project...'}
                </Text>
                <ChevronDown size={20} color="rgba(255,255,255,0.45)" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
              {projectPickerOpen ? (
                <View style={styles.pickerList}>
                  <ScrollView style={styles.pickerScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {targets.map((p) => {
                      const active = selectedTarget?.id === p.id && selectedTarget.kind === p.kind
                      return (
                        <TouchableOpacity
                          key={`${p.kind}:${p.id}`}
                          style={[styles.pickerRow, active && styles.pickerRowActive]}
                          onPress={() => {
                            setSelectedTarget(p)
                            setProjectPickerOpen(false)
                          }}
                        >
                          <Text style={styles.pickerRowText} numberOfLines={2}>
                            {p.kind === 'job' ? 'Project (Job Pool)' : 'Project'} · {p.title}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </ScrollView>
                </View>
              ) : null}
            </>
          )}

          <Text style={styles.fieldLbl}>MESSAGE</Text>
          <TextInput
            style={styles.messageInput}
            multiline
            placeholder={`Hi ${freelancerName.trim() || 'there'}! We'd love to book you for…`}
            placeholderTextColor="rgba(255,255,255,0.28)"
            value={message}
            onChangeText={setMessage}
            textAlignVertical="top"
          />

          {loadError ? <Text style={styles.err}>{loadError}</Text> : null}

          <View style={styles.footerRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={sending}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendBtn, (sending || !selectedTarget || sorted.length === 0) && styles.sendBtnDim]}
              onPress={() => void onSend()}
              disabled={sending || !selectedTarget || sorted.length === 0}
            >
              {sending ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <Text style={styles.sendBtnText}>Send Booking Request</Text>
              )}
            </TouchableOpacity>
          </View>
            </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  backdropHit: { ...StyleSheet.absoluteFillObject },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: '#161616',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
    maxHeight: '88%',
  },
  cardScroll: { padding: 20, paddingBottom: 24 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  avatarImg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#FFDC00',
    backgroundColor: '#222',
  },
  avatarRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#FFDC00',
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 20, fontWeight: '900', color: '#0a0a0a' },
  headerTextCol: { flex: 1, minWidth: 0 },
  kicker: {
    fontSize: 12,
    fontWeight: '900',
    color: '#FFDC00',
    letterSpacing: 1.2,
  },
  nameSub: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  dateBox: {
    borderWidth: 1,
    borderColor: '#FFDC00',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
  },
  dateRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  dateCol: { flex: 1, minWidth: 0 },
  fromToLbl: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1,
    marginBottom: 4,
  },
  dateBig: { fontSize: 11, fontWeight: '800', color: '#fff', lineHeight: 14 },
  arrow: { fontSize: 18, color: '#FFDC00', fontWeight: '700', paddingBottom: 4 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  dayCountLbl: { fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.38)' },
  rateLbl: { fontSize: 11, fontWeight: '900', color: '#FFDC00', letterSpacing: 0.6 },
  totalEst: { marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.35)' },
  fieldLbl: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  selectShell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#0f0f0f',
    marginBottom: 8,
  },
  selectText: { flex: 1, fontSize: 14, color: 'rgba(255,255,255,0.85)', marginRight: 8 },
  pickerList: {
    maxHeight: 160,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    marginBottom: 16,
    overflow: 'hidden',
    backgroundColor: '#0f0f0f',
  },
  pickerScroll: { maxHeight: 160 },
  pickerRow: { paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  pickerRowActive: { backgroundColor: 'rgba(255,220,0,0.12)' },
  pickerRowText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  messageInput: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#fff',
    marginBottom: 16,
    backgroundColor: '#0f0f0f',
  },
  footerRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.75)' },
  sendBtn: {
    flex: 1,
    minWidth: 168,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  sendBtnDim: { opacity: 0.45 },
  sendBtnText: { fontSize: 13, fontWeight: '800', color: '#0a0a0a' },
  err: { fontSize: 12, color: 'rgba(248,113,113,0.95)', marginBottom: 10 },
  loadingRow: { paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  emptyProj: { marginBottom: 16 },
  emptyProjText: { fontSize: 13, color: 'rgba(255,255,255,0.42)', lineHeight: 19, marginBottom: 12 },
})
