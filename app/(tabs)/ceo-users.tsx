import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { useCeoAccess } from '@/lib/useCeoAccess'

type UserRow = {
  id: string
  name: string
  role: string
  avatar_url: string | null
  headline: string
  email: string
}

function parseUsersPayload(raw: unknown): { ok: boolean; users: UserRow[] } {
  if (!raw || typeof raw !== 'object') return { ok: false, users: [] }
  const o = raw as Record<string, unknown>
  const arr = Array.isArray(o.users) ? o.users : []
  return {
    ok: o.ok === true,
    users: arr.map((r) => {
      const x = r as Record<string, unknown>
      const av = x.avatar_url
      return {
        id: String(x.id ?? ''),
        name: String(x.name ?? ''),
        role: String(x.role ?? ''),
        avatar_url: typeof av === 'string' ? av : null,
        headline: String(x.headline ?? ''),
        email: String(x.email ?? ''),
      }
    }),
  }
}

export default function CeoUsersScreen() {
  const router = useRouter()
  const { ready, allowed } = useCeoAccess()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<UserRow[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async (isRefresh?: boolean) => {
    if (!allowed) return
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setHint(null)
    const { data, error } = await supabase.rpc('ceo_list_users', {
      p_search: debounced,
      p_limit: 150,
    })
    setLoading(false)
    setRefreshing(false)
    if (error) {
      setHint(error.message)
      setRows([])
      return
    }
    const parsed = parseUsersPayload(data)
    if (!parsed.ok) {
      setHint('CEO access required, or run supabase/sql/ceo_admin_rpcs.sql.')
      setRows([])
      return
    }
    setRows(parsed.users)
  }, [allowed, debounced])

  useEffect(() => {
    if (ready && allowed) load()
  }, [ready, allowed, load])

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.deniedTitle}>Access denied</Text>
          <Text style={styles.deniedSub}>This area is for CEO accounts only.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backText}>Dashboard</Text>
      </TouchableOpacity>

      <Text style={styles.kicker}>PLATFORM</Text>
      <Text style={styles.title}>Users</Text>

      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search name or email…"
        placeholderTextColor="rgba(255,255,255,0.28)"
        autoCapitalize="none"
        autoCorrect={false}
      />

      {hint ? (
        <View style={styles.hintBox}>
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.listPad}>
          <ActivityIndicator color="#FFDC00" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={() => load(true)}
          ListEmptyComponent={
            <Text style={styles.empty}>No users match this search.</Text>
          }
          renderItem={({ item }) => {
            const uri = item.avatar_url?.trim() ?? ''
            const show = /^https?:\/\//i.test(uri)
            const initial = (item.name || '?').trim().charAt(0).toUpperCase() || '?'
            return (
              <View style={styles.row}>
                {show ? (
                  <Image source={{ uri }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarPh}>
                    <Text style={styles.avatarLetter}>{initial}</Text>
                  </View>
                )}
                <View style={styles.rowBody}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name.trim() || 'Unnamed'}
                  </Text>
                  <Text style={styles.rowEmail} numberOfLines={1}>
                    {item.email || '—'}
                  </Text>
                  {item.headline.trim() ? (
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {item.headline.trim()}
                    </Text>
                  ) : null}
                  <View style={styles.rolePill}>
                    <Text style={styles.rolePillText}>{item.role || '—'}</Text>
                  </View>
                </View>
              </View>
            )
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a', paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, alignSelf: 'flex-start' },
  backText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 2,
    marginBottom: 6,
  },
  title: { fontSize: 26, fontWeight: '900', color: '#ffffff', marginBottom: 16 },
  search: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#ffffff',
    marginBottom: 12,
  },
  hintBox: {
    backgroundColor: 'rgba(255,220,0,0.08)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
  },
  hintText: { fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 17 },
  listPad: { paddingVertical: 24 },
  listContent: { paddingBottom: 40 },
  empty: { color: 'rgba(255,255,255,0.35)', fontSize: 14, textAlign: 'center', marginTop: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#222' },
  avatarPh: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,220,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 18, fontWeight: '800', color: '#FFDC00' },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.92)' },
  rowEmail: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  rowSub: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
  rolePill: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    backgroundColor: 'rgba(255,220,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.2)',
  },
  rolePillText: { fontSize: 10, fontWeight: '700', color: '#FFDC00', textTransform: 'capitalize' },
  deniedTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 8 },
  deniedSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
})
