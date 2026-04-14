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
import { UserMinus } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'

type Member = {
  id: string
  profile_id: string
  member_role: string
  profiles: { name: string | null; avatar_url: string | null } | null
}

type Props = { projectId: string; canManage: boolean }

const roleLabel = (r: string) => {
  if (r === 'company') return 'Client'
  if (r === 'lead') return 'Lead'
  return 'Crew'
}

export function ProjectCrewTab({ projectId, canManage }: Props) {
  const [rows, setRows] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_members')
      .select('id, profile_id, member_role, profiles(name, avatar_url)')
      .eq('project_id', projectId)
      .order('member_role', { ascending: true })

    if (error) {
      Alert.alert('Crew', error.message)
      setRows([])
    } else {
      setRows((data as unknown as Member[]) ?? [])
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const addByEmail = async () => {
    const e = email.trim().toLowerCase()
    if (!e || busy) return
    setBusy(true)
    const { error } = await supabase.rpc('add_project_crew_by_email', {
      p_project_id: projectId,
      p_email: e,
    })
    setBusy(false)
    if (error) {
      Alert.alert('Could not add', error.message)
      return
    }
    setEmail('')
    load()
    Alert.alert('Added', 'They now have access to this project workspace.')
  }

  const removeCrew = (m: Member) => {
    if (m.member_role !== 'crew') return
    Alert.alert('Remove crew member', 'They will lose access to this project.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('project_members').delete().eq('id', m.id)
          if (error) {
            Alert.alert('Remove failed', error.message)
            return
          }
          load()
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
      {canManage && (
        <>
          <Text style={styles.label}>Invite by email</Text>
          <Text style={styles.hint}>They must already have a Crea account with this email.</Text>
          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              placeholder="name@studio.com"
              placeholderTextColor="rgba(255,255,255,0.25)"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TouchableOpacity style={[styles.addBtn, busy && styles.dim]} onPress={addByEmail} disabled={busy}>
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Text style={styles.label}>People on this project</Text>
      {rows.map((m) => {
        const prof = m.profiles as
          | { name: string | null; avatar_url: string | null }
          | { name: string | null; avatar_url: string | null }[]
          | null
          | undefined
        const p = Array.isArray(prof) ? prof[0] : prof
        return (
          <View key={m.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{p?.name || 'Member'}</Text>
              <Text style={styles.role}>{roleLabel(m.member_role)}</Text>
            </View>
            {canManage && m.member_role === 'crew' ? (
              <TouchableOpacity onPress={() => removeCrew(m)} hitSlop={8}>
                <UserMinus size={20} color="rgba(255,100,100,0.9)" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
            ) : null}
          </View>
        )
      })}
    </ScrollView>
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
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
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
})
