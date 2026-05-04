import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { X } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { sendAvailabilityProjectInvite } from '@/lib/sendAvailabilityProjectInvite'

type ProjectRow = { id: string; title: string }

type Props = {
  visible: boolean
  onClose: () => void
  companyUserId: string
  freelancerId: string
  freelancerName: string
  selectedIso: string | null
  onInviteSent: (conversationId: string) => void
}

export function InviteFreelancerDateModal({
  visible,
  onClose,
  companyUserId,
  freelancerId,
  freelancerName,
  selectedIso,
  onInviteSent,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [newProjectTitle, setNewProjectTitle] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)

  const dateLabel =
    selectedIso != null
      ? new Date(`${selectedIso}T12:00:00`).toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : ''

  const loadProjects = useCallback(async () => {
    setLoadError(null)
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('id, title')
      .eq('company_id', companyUserId)
      .eq('freelancer_id', freelancerId)
      .order('updated_at', { ascending: false })

    if (error) {
      setLoadError(error.message)
      setProjects([])
    } else {
      setProjects(
        (data ?? []).map((r) => ({
          id: String(r.id),
          title: String(r.title ?? '').trim() || 'Untitled project',
        }))
      )
    }
    setLoading(false)
  }, [companyUserId, freelancerId])

  useEffect(() => {
    if (!visible || !selectedIso) return
    void loadProjects()
  }, [visible, selectedIso, loadProjects])

  useEffect(() => {
    if (!visible) {
      setNewProjectTitle('')
      setCreatingProject(false)
    }
  }, [visible])

  const createPrivateProject = async (): Promise<ProjectRow | null> => {
    if (creatingProject || companyUserId === freelancerId) return null
    const t =
      newProjectTitle.trim() ||
      `Collaboration — ${freelancerName.trim() || 'freelancer'}`
    setCreatingProject(true)
    setLoadError(null)
    const { data: created, error } = await supabase
      .from('projects')
      .insert({
        company_id: companyUserId,
        freelancer_id: freelancerId,
        title: t,
        brief_ai_outputs: {},
        budget_type: 'negotiable',
        location: 'Remote',
      })
      .select('id, title')
      .single()
    setCreatingProject(false)
    if (error || !created?.id) {
      setLoadError(error?.message ?? 'Could not create project')
      return null
    }
    setNewProjectTitle('')
    const row: ProjectRow = {
      id: String(created.id),
      title: String(created.title ?? t).trim() || t,
    }
    setProjects([row])
    return row
  }

  const pickProject = async (p: ProjectRow) => {
    if (!selectedIso || sending) return
    setSending(true)
    const r = await sendAvailabilityProjectInvite({
      freelancerId,
      projectId: p.id,
      projectTitle: p.title,
      isoStartDate: selectedIso,
      isoEndDate: selectedIso,
    })
    setSending(false)
    if (r.ok) {
      onInviteSent(r.conversationId)
      onClose()
    } else {
      setLoadError('error' in r ? r.error : 'Could not send invite')
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Invite to project</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <X size={24} color="#fff" strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          </View>
          <Text style={styles.sub}>
            {freelancerName.trim() || 'Freelancer'} — {dateLabel}
          </Text>
          <Text style={styles.hint}>Choose a workspace you share with them. We’ll send a message with this date.</Text>

          {loading ? (
            <View style={styles.centerPad}>
              <ActivityIndicator color="#FFDC00" />
            </View>
          ) : (
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {projects.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>
                    No shared private project yet. Create one below — it will not appear on the public job board — and
                    we will send this date invite right away.
                  </Text>
                  <TextInput
                    style={styles.draftInput}
                    value={newProjectTitle}
                    onChangeText={setNewProjectTitle}
                    placeholder="Project name (optional)"
                    placeholderTextColor="rgba(255,255,255,0.28)"
                  />
                  <TouchableOpacity
                    style={[styles.secondaryBtn, (creatingProject || sending) && styles.secondaryBtnDim]}
                    onPress={() =>
                      void (async () => {
                        const row = await createPrivateProject()
                        if (row) await pickProject(row)
                      })()
                    }
                    disabled={creatingProject || sending}
                  >
                    {creatingProject || sending ? (
                      <ActivityIndicator color="#0a0a0a" />
                    ) : (
                      <Text style={styles.secondaryBtnText}>Create & send invite</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                projects.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.row}
                    onPress={() => void pickProject(p)}
                    disabled={sending}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.rowTitle} numberOfLines={2}>
                      {p.title}
                    </Text>
                    <Text style={styles.rowChev}>→</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          )}
          {loadError ? <Text style={styles.err}>{loadError}</Text> : null}
          {sending ? (
            <View style={styles.sendingRow}>
              <ActivityIndicator color="#FFDC00" size="small" />
              <Text style={styles.sendingText}>Sending…</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '78%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '800', color: '#fff' },
  sub: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.75)', marginBottom: 8 },
  hint: { fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 17, marginBottom: 14 },
  centerPad: { paddingVertical: 24, alignItems: 'center' },
  list: { maxHeight: 320 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#fff', marginRight: 12 },
  rowChev: { fontSize: 16, color: '#FFDC00', fontWeight: '700' },
  emptyBox: { paddingVertical: 8 },
  emptyText: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 19, marginBottom: 16 },
  draftInput: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#fff',
    marginBottom: 12,
    backgroundColor: '#0f0f0f',
  },
  secondaryBtn: {
    alignSelf: 'stretch',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  secondaryBtnDim: { opacity: 0.55 },
  secondaryBtnText: { fontSize: 14, fontWeight: '800', color: '#0a0a0a' },
  err: { marginTop: 10, fontSize: 12, color: 'rgba(248,113,113,0.95)' },
  sendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  sendingText: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
})
