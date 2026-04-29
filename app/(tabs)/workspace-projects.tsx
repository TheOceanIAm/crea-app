import { useCallback, useState } from 'react'
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { ChevronLeft, Plus } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { supabase } from '@/lib/supabase'
import { isFreelancerProfile, resolveAppRole } from '@/lib/profileRole'
import { isFreelancerWorkspaceOnlyPlan, resolveFreelancerPlanFromUser } from '@/lib/freelancerPlan'

type WorkspaceProject = {
  id: string
  title: string
  status: string | null
  updated_at: string | null
  brief_ai_context: string | null
  workspace_summary: string | null
  brief_ai_outputs: Record<string, unknown> | null
}

function fmtDate(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function WorkspaceProjectsScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [rows, setRows] = useState<WorkspaceProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editOutputs, setEditOutputs] = useState<Record<string, unknown>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setAllowed(false)
      setRows([])
      setLoading(false)
      router.replace('/login')
      return
    }

    const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    const role = resolveAppRole(p?.role, user)
    const workspaceOnly =
      isFreelancerProfile(role) && isFreelancerWorkspaceOnlyPlan(resolveFreelancerPlanFromUser(user))
    if (!workspaceOnly) {
      setAllowed(false)
      setRows([])
      setLoading(false)
      return
    }
    setAllowed(true)

    const { data, error: qErr } = await supabase
      .from('projects')
      .select('id, title, status, updated_at, brief_ai_context, brief_ai_outputs')
      .eq('company_id', user.id)
      .eq('freelancer_id', user.id)
      .order('updated_at', { ascending: false })

    if (qErr) {
      setError(qErr.message)
      setRows([])
    } else {
      setRows(
        (data ?? []).map((r) => ({
          id: String(r.id),
          title: String(r.title ?? '').trim() || 'Untitled project',
          status: typeof r.status === 'string' ? r.status : null,
          updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
          brief_ai_context: typeof r.brief_ai_context === 'string' ? r.brief_ai_context : null,
          workspace_summary:
            r.brief_ai_outputs && typeof r.brief_ai_outputs === 'object' && typeof (r.brief_ai_outputs as Record<string, unknown>).workspace_summary === 'string'
              ? String((r.brief_ai_outputs as Record<string, unknown>).workspace_summary)
              : null,
          brief_ai_outputs:
            r.brief_ai_outputs && typeof r.brief_ai_outputs === 'object' ? (r.brief_ai_outputs as Record<string, unknown>) : null,
        }))
      )
    }
    setLoading(false)
  }, [router])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const onCreate = async () => {
    const t = title.trim()
    if (!t || creating) return
    setCreating(true)
    setError(null)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setCreating(false)
      setError('Please sign in again.')
      return
    }
    const { data: created, error: insErr } = await supabase
      .from('projects')
      .insert({
        company_id: user.id,
        freelancer_id: user.id,
        title: t,
        brief_ai_context: notes.trim() || null,
        brief_ai_outputs: { workspace_summary: notes.trim() || '' },
        budget_type: 'negotiable',
        location: 'Remote',
      })
      .select('id')
      .single()
    setCreating(false)
    if (insErr || !created?.id) {
      setError(insErr?.message ?? 'Could not create workspace.')
      return
    }
    setCreateOpen(false)
    setTitle('')
    setNotes('')
    router.push(`/project/${created.id}` as Href)
  }

  const openEdit = (item: WorkspaceProject) => {
    setEditId(item.id)
    setEditTitle(item.title)
    setEditNotes(item.workspace_summary ?? item.brief_ai_context ?? '')
    setEditOutputs(item.brief_ai_outputs ?? {})
    setEditOpen(true)
  }

  const saveEdit = async () => {
    const t = editTitle.trim()
    if (!editId || !t || actingId) return
    setActingId(editId)
    setError(null)
    const { error: updErr } = await supabase
      .from('projects')
      .update({
        title: t,
        brief_ai_context: editNotes.trim() || null,
        brief_ai_outputs: { ...editOutputs, workspace_summary: editNotes.trim() || '' },
      })
      .eq('id', editId)
    setActingId(null)
    if (updErr) {
      setError(updErr.message)
      return
    }
    setEditOpen(false)
    setEditId(null)
    setEditTitle('')
    setEditNotes('')
    setEditOutputs({})
    await load()
  }

  const archiveProject = async (item: WorkspaceProject) => {
    if (actingId) return
    setActingId(item.id)
    setError(null)
    const next = item.status === 'archived' ? 'active' : 'archived'
    const { error: updErr } = await supabase.from('projects').update({ status: next }).eq('id', item.id)
    setActingId(null)
    if (updErr) {
      setError(updErr.message)
      return
    }
    await load()
  }

  const deleteProject = async (item: WorkspaceProject) => {
    if (actingId) return
    Alert.alert(
      'Delete project',
      'This removes the project permanently. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setActingId(item.id)
              setError(null)
              const { error: delErr } = await supabase.from('projects').delete().eq('id', item.id)
              setActingId(null)
              if (delErr) {
                setError(delErr.message)
                return
              }
              await load()
            })()
          },
        },
      ]
    )
  }

  if (loading || allowed === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.blockTitle}>Workspace plan only</Text>
          <Text style={styles.blockSub}>This area is available for freelancers on the Workspace plan.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Dashboard</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.newBtn} onPress={() => setCreateOpen(true)}>
          <Plus size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
          <Text style={styles.newBtnText}>New project</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>Projects</Text>
      <Text style={styles.sub}>Private workspace projects only (not public job listings).</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.emptySub}>Create your first private workspace project.</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => setCreateOpen(true)}>
              <Text style={styles.emptyBtnText}>+ New project</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.cardMeta}>
              {item.status?.toUpperCase() || 'ACTIVE'} · Updated {fmtDate(item.updated_at)}
            </Text>
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.cardBtnPrimary} onPress={() => router.push(`/project/${item.id}` as Href)}>
                <Text style={styles.cardBtnPrimaryText}>Open</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cardBtnGhost} onPress={() => openEdit(item)}>
                <Text style={styles.cardBtnGhostText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cardBtnGhost} onPress={() => void archiveProject(item)} disabled={actingId === item.id}>
                <Text style={styles.cardBtnGhostText}>{item.status === 'archived' ? 'Unarchive' : 'Archive'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cardBtnDanger} onPress={() => void deleteProject(item)} disabled={actingId === item.id}>
                <Text style={styles.cardBtnDangerText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New project</Text>
            <Text style={styles.modalSub}>Opens your private workspace, not a public job listing.</Text>

            <Text style={styles.fieldLabel}>Project name</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Brand film — spring"
              placeholderTextColor="rgba(255,255,255,0.3)"
            />

            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputTall]}
              value={notes}
              onChangeText={setNotes}
              multiline
              textAlignVertical="top"
              placeholder="Short context for yourself — you can add more in the workspace."
              placeholderTextColor="rgba(255,255,255,0.3)"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setCreateOpen(false)}
                disabled={creating}
              >
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnAccent, (!title.trim() || creating) && styles.dim]}
                onPress={onCreate}
                disabled={!title.trim() || creating}
              >
                <Text style={styles.modalBtnAccentText}>{creating ? 'Creating…' : 'Create & open workspace'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit project</Text>
            <Text style={styles.modalSub}>Update project title and notes for this private workspace project.</Text>

            <Text style={styles.fieldLabel}>Project name</Text>
            <TextInput
              style={styles.input}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Project name"
              placeholderTextColor="rgba(255,255,255,0.3)"
            />

            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputTall]}
              value={editNotes}
              onChangeText={setEditNotes}
              multiline
              textAlignVertical="top"
              placeholder="Project context"
              placeholderTextColor="rgba(255,255,255,0.3)"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnGhost]} onPress={() => setEditOpen(false)} disabled={!!actingId}>
                <Text style={styles.modalBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnAccent, (!editTitle.trim() || !!actingId) && styles.dim]}
                onPress={() => void saveEdit()}
                disabled={!editTitle.trim() || !!actingId}
              >
                <Text style={styles.modalBtnAccentText}>{actingId ? 'Saving…' : 'Save changes'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0a0a0a' },
  topRow: {
    paddingHorizontal: 20,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontSize: 16, color: '#FFDC00', fontWeight: '600' },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#FFDC00',
  },
  newBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 12 },
  title: { fontSize: 26, color: '#fff', fontWeight: '900', paddingHorizontal: 20, marginTop: 10 },
  sub: { fontSize: 13, color: 'rgba(255,255,255,0.4)', paddingHorizontal: 20, marginTop: 6, marginBottom: 12 },
  error: { fontSize: 12, color: '#ff9b9b', paddingHorizontal: 20, marginBottom: 8 },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 10, flexGrow: 1 },
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
  },
  cardTitle: { fontSize: 15, color: '#fff', fontWeight: '700', marginBottom: 6 },
  cardMeta: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  cardBtnPrimary: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#FFDC00' },
  cardBtnPrimaryText: { fontSize: 12, color: '#0a0a0a', fontWeight: '800' },
  cardBtnGhost: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  cardBtnGhostText: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '700' },
  cardBtnDanger: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,120,120,0.45)',
    backgroundColor: 'rgba(255,80,80,0.06)',
  },
  cardBtnDangerText: { fontSize: 12, color: '#ff8e8e', fontWeight: '800' },
  emptyCard: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#111',
    padding: 20,
    alignItems: 'center',
  },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  emptySub: { color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center', marginBottom: 14, lineHeight: 18 },
  emptyBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: '#FFDC00' },
  emptyBtnText: { color: '#0a0a0a', fontWeight: '800' },
  blockTitle: { fontSize: 19, color: '#fff', fontWeight: '800', marginBottom: 8 },
  blockSub: { fontSize: 14, color: 'rgba(255,255,255,0.45)', textAlign: 'center', lineHeight: 20 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: '#141414',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 18,
  },
  modalTitle: { fontSize: 30, fontWeight: '900', color: '#FFDC00', textTransform: 'uppercase', marginBottom: 6 },
  modalSub: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18, marginBottom: 14 },
  fieldLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: 7,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    backgroundColor: '#1c1c1c',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  inputTall: { minHeight: 110 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 999, alignItems: 'center' },
  modalBtnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  modalBtnGhostText: { color: 'rgba(255,255,255,0.8)', fontWeight: '700' },
  modalBtnAccent: { backgroundColor: '#FFDC00' },
  modalBtnAccentText: { color: '#0a0a0a', fontWeight: '800' },
  dim: { opacity: 0.6 },
})
