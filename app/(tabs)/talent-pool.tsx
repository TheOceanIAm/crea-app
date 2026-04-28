import { useCallback, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { ChevronLeft, MapPin } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { isCompanyProfile, resolveAppRole } from '@/lib/profileRole'
import { ICON_STROKE } from '@/lib/iconTheme'

type TalentRow = {
  id: string
  name: string
  headline: string
  location: string
  avatarUrl: string | null
  role: string | null
}

type FreelancerDirectoryRow = {
  id: string
  location: string | null
  plan_tier: string | null
}

function initial(name: string) {
  const t = name.trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}

export default function TalentPoolScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [rows, setRows] = useState<TalentRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setAllowed(false)
      setRows([])
      setLoading(false)
      router.replace('/login')
      return
    }
    const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = resolveAppRole(p?.role, user)
    if (!isCompanyProfile(role)) {
      setAllowed(false)
      setRows([])
      setLoading(false)
      return
    }
    setAllowed(true)

    const { data: fpRows, error: fpErr } = await supabase
      .from('freelancer_profiles')
      .select('id, location, plan_tier')
      .neq('plan_tier', 'workspace')
      .limit(240)

    if (fpErr) {
      setLoadError(fpErr.message)
      setRows([])
    } else {
      const candidates = (fpRows ?? []) as unknown as FreelancerDirectoryRow[]
      const ids = [
        ...new Set(
          candidates
            .map((r) => (typeof r.id === 'string' ? r.id.trim() : ''))
            .filter((x) => x.length > 0)
        ),
      ]
      if (ids.length === 0) {
        setRows([])
        setLoading(false)
        return
      }
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, name, headline, location, avatar_url, role')
        .in('id', ids)
        .neq('role', 'company')
        .neq('role', 'ceo')
        .order('name', { ascending: true })
      if (pErr) {
        setLoadError(pErr.message)
        setRows([])
      } else {
        const fpById = new Map<string, FreelancerDirectoryRow>()
        for (const fp of candidates) {
          if (typeof fp.id === 'string' && fp.id.trim()) fpById.set(fp.id.trim(), fp)
        }
        setRows(
          (profiles ?? []).map((r) => {
            const id = String(r.id)
            const fp = fpById.get(id)
            const url = (r.avatar_url as string | null)?.trim()
            const profileLoc = String(r.location ?? '').trim()
            const fpLoc = fp?.location ? String(fp.location).trim() : ''
            return {
              id,
              name: String(r.name ?? '').trim() || 'Freelancer',
              headline: String(r.headline ?? '').trim(),
              location: profileLoc || fpLoc,
              avatarUrl: url && /^https?:\/\//i.test(url) ? url : null,
              role: typeof r.role === 'string' ? r.role : null,
            }
          })
        )
      }
    }
    setLoading(false)
  }, [router])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  if (allowed === null || loading) {
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
          <Text style={styles.blockTitle}>Companies only</Text>
          <Text style={styles.blockSub}>Talent pool is available for company accounts.</Text>
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

      <Text style={styles.title}>Talent pool</Text>
      <Text style={styles.subtitle}>Freelancers on Crea — open a public profile to learn more.</Text>

      {loadError ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{loadError}</Text>
          <Text style={styles.bannerHint}>
            If this persists, your project may need RLS policies so companies can read freelancer profiles for
            discovery.
          </Text>
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !loadError ? (
            <Text style={styles.empty}>No freelancers found yet.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.75}
            onPress={() => router.push(`/profile/${item.id}` as Href)}
          >
            <View style={styles.avatarWrap}>
              {item.avatarUrl ? (
                <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarPh}>
                  <Text style={styles.avatarLetter}>{initial(item.name)}</Text>
                </View>
              )}
            </View>
            <View style={styles.meta}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              {item.headline ? (
                <Text style={styles.headline} numberOfLines={1}>
                  {item.headline}
                </Text>
              ) : null}
              {item.location ? (
                <View style={styles.locRow}>
                  <MapPin size={12} color="rgba(255,255,255,0.35)" strokeWidth={ICON_STROKE} />
                  <Text style={styles.location} numberOfLines={1}>
                    {item.location}
                  </Text>
                </View>
              ) : null}
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 20, paddingTop: 8 },
  backText: { fontSize: 16, fontWeight: '600', color: '#FFDC00' },
  title: {
    fontSize: 26,
    fontWeight: '900',
    color: '#ffffff',
    paddingHorizontal: 20,
    marginTop: 8,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 20,
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 18,
  },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  avatarWrap: {},
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#222' },
  avatarPh: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: 20, fontWeight: '800', color: '#FFDC00' },
  meta: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 2 },
  headline: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 4 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  location: { fontSize: 12, color: 'rgba(255,255,255,0.3)', flex: 1 },
  empty: { color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 40 },
  blockTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 8 },
  blockSub: { fontSize: 14, color: 'rgba(255,255,255,0.45)', textAlign: 'center' },
  banner: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  bannerText: { fontSize: 13, color: 'rgba(255,200,200,0.95)', marginBottom: 6 },
  bannerHint: { fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 16 },
})
