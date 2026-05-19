import { useCallback, useEffect, useState } from 'react'
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
import { Check, Plus, Trash2 } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { ICON_STROKE } from '@/lib/iconTheme'

type Milestone = {
  id: string
  project_id: string
  title: string
  sort_order: number
  completed: boolean
}

type Props = {
  projectId: string
  onCountsChanged?: () => void
  /** Company or lead: add/remove milestones. Crew can still mark items complete when false. */
  canManage: boolean
}

export function ProjectMilestonesTab({ projectId, onCountsChanged, canManage }: Props) {
  const [rows, setRows] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_milestones')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })

    if (error) {
      Alert.alert('Milestones', error.message)
      setRows([])
    } else {
      setRows((data as Milestone[]) ?? [])
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const add = async () => {
    const t = newTitle.trim()
    if (!t || busy) return
    setBusy(true)
    const nextOrder = rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 0
    const { data, error } = await supabase
      .from('project_milestones')
      .insert({ project_id: projectId, title: t, sort_order: nextOrder })
      .select('*')
      .single()
    setBusy(false)
    if (error) {
      Alert.alert('Could not add', error.message)
      return
    }
    setNewTitle('')
    setRows((prev) => [...prev, data as Milestone])
    onCountsChanged?.()
    void notifyExpoEvent({
      kind: 'workspace_activity',
      projectId,
      activity: 'milestone',
      detail: t,
    })
  }

  const toggle = async (m: Milestone) => {
    const { error } = await supabase
      .from('project_milestones')
      .update({ completed: !m.completed })
      .eq('id', m.id)
    if (error) {
      Alert.alert('Update failed', error.message)
      return
    }
    setRows((prev) => prev.map((r) => (r.id === m.id ? { ...r, completed: !r.completed } : r)))
    onCountsChanged?.()
  }

  const remove = (m: Milestone) => {
    Alert.alert('Remove milestone', m.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('project_milestones').delete().eq('id', m.id)
          if (error) {
            Alert.alert('Delete failed', error.message)
            return
          }
          setRows((prev) => prev.filter((r) => r.id !== m.id))
          onCountsChanged?.()
        },
      },
    ])
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.hint}>
        {canManage
          ? 'Add or remove steps as the client or lead. The crew can check items off below.'
          : 'Check off steps as you go. Only the company or lead can edit the list.'}
      </Text>

      {canManage ? (
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="New milestone…"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={newTitle}
            onChangeText={setNewTitle}
            onSubmitEditing={add}
          />
          <TouchableOpacity style={[styles.addBtn, busy && styles.dim]} onPress={add} disabled={busy}>
            <Plus size={22} color="#0a0a0a" strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>
      ) : null}

      {rows.length === 0 ? (
        <Text style={styles.empty}>
          {canManage ? 'No milestones yet — add the first one above.' : 'No milestones yet.'}
        </Text>
      ) : (
        rows.map((m) => (
          <View key={m.id} style={styles.row}>
            <TouchableOpacity style={styles.checkWrap} onPress={() => toggle(m)} hitSlop={8}>
              {m.completed ? (
                <View style={styles.checkOn}>
                  <Check size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
                </View>
              ) : (
                <View style={styles.checkOff} />
              )}
            </TouchableOpacity>
            <Text style={[styles.title, m.completed && styles.titleDone]}>{m.title}</Text>
            {canManage ? (
              <TouchableOpacity onPress={() => remove(m)} hitSlop={8}>
                <Trash2 size={18} color="rgba(255,255,255,0.25)" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
            ) : (
              <View style={styles.trashSpacer} />
            )}
          </View>
        ))
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: 32 },
  center: { paddingVertical: 40, alignItems: 'center' },
  hint: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18, marginBottom: 16 },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
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
    width: 48,
    borderRadius: 12,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.5 },
  empty: { fontSize: 14, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  checkWrap: { padding: 4 },
  checkOff: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  checkOn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 15, color: 'rgba(255,255,255,0.9)' },
  titleDone: { textDecorationLine: 'line-through', color: 'rgba(255,255,255,0.35)' },
  trashSpacer: { width: 18 },
})
