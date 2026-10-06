import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { KeyboardAwareScrollView } from '@/components/KeyboardAwareScrollView'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { ChevronLeft } from 'lucide-react-native'
import { returnToPreviousScreen } from '@/lib/screenReturn'
import { ICON_STROKE } from '@/lib/iconTheme'
import { fetchCreaApi } from '@/lib/creaApiFetch'

type FeedResponse = {
  connected?: boolean
  httpsUrl?: string
  webcalUrl?: string
  googleUrl?: string
  error?: string
}

export default function ProjectCalendarScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feed, setFeed] = useState<FeedResponse | null>(null)

  const load = useCallback(async () => {
    const res = await fetchCreaApi<FeedResponse>('/api/app/calendar/feed')
    if (res.error || !res.data) {
      setError(res.error === 'no_session' ? 'Sign in again to connect a calendar.' : res.error || 'Could not load the calendar link.')
      setFeed(null)
      return
    }
    setError(null)
    setFeed(res.data)
  }, [])

  useEffect(() => {
    void load().finally(() => setLoading(false))
  }, [load])

  async function connect(rotate = false) {
    setBusy(true)
    const res = await fetchCreaApi<FeedResponse>('/api/app/calendar/feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rotate }),
    })
    setBusy(false)
    if (res.error || !res.data?.httpsUrl) {
      setError(res.error || 'Could not create the calendar link.')
      return
    }
    setError(null)
    setFeed(res.data)
  }

  async function disconnect() {
    setBusy(true)
    const res = await fetchCreaApi<FeedResponse>('/api/app/calendar/feed', { method: 'DELETE' })
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setError(null)
    setFeed({ connected: false })
  }

  const connected = Boolean(feed?.connected && feed.httpsUrl && feed.webcalUrl && feed.googleUrl)

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => returnToPreviousScreen(router, '/(tabs)/profile')} hitSlop={12}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>Profile</Text>
        </TouchableOpacity>
      </View>
      <KeyboardAwareScrollView style={styles.scroll} contentContainerStyle={styles.content} extraBottomPadding={32}>
        <Text style={styles.kicker}>CALENDAR</Text>
        <Text style={styles.title}>Booked days,</Text>
        <Text style={styles.titleAccent}>in your calendar.</Text>
        <Text style={styles.subtitle}>
          When you are booked, those days show as the project title with a link to the project. If you own the job, the production window shows up the same way.
        </Text>

        {loading ? <ActivityIndicator color="#FFDC00" style={{ marginTop: 24 }} /> : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && !connected ? (
          <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => void connect(false)}>
            <Text style={styles.primaryText}>{busy ? 'Connecting…' : 'Connect calendar'}</Text>
          </TouchableOpacity>
        ) : null}

        {!loading && connected ? (
          <View style={styles.card}>
            <Text style={styles.linkLabel}>CALENDAR LINK</Text>
            <Text style={styles.link} selectable>
              {feed?.httpsUrl}
            </Text>
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => {
                void Clipboard.setStringAsync(feed?.httpsUrl ?? '')
                Alert.alert('Copied', 'Paste this link into Apple Calendar or Google Calendar.')
              }}
            >
              <Text style={styles.secondaryText}>Copy link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryInCard} onPress={() => void Linking.openURL(feed?.webcalUrl ?? '')}>
              <Text style={styles.primaryText}>Add to Apple Calendar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => void Linking.openURL(feed?.googleUrl ?? '')}>
              <Text style={styles.secondaryText}>Add to Google Calendar</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>
              New bookings show up the next time Apple or Google refreshes the calendar.
            </Text>
            <View style={styles.row}>
              <TouchableOpacity disabled={busy} onPress={() => void connect(true)}>
                <Text style={styles.quiet}>New link</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={busy} onPress={() => void disconnect()}>
                <Text style={styles.danger}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  topBar: { paddingHorizontal: 12, paddingBottom: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 8 },
  backLabel: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  scroll: { flex: 1 },
  content: { paddingBottom: 40 },
  kicker: { fontSize: 11, fontWeight: '700', color: '#FFDC00', letterSpacing: 2, marginBottom: 10, paddingHorizontal: 20 },
  title: { fontSize: 26, fontWeight: '900', color: '#ffffff', paddingHorizontal: 20 },
  titleAccent: { fontSize: 26, fontWeight: '900', color: '#FFDC00', marginBottom: 12, paddingHorizontal: 20 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.38)', lineHeight: 20, marginBottom: 20, paddingHorizontal: 20 },
  error: { color: '#f87171', fontSize: 13, lineHeight: 18, paddingHorizontal: 20, marginBottom: 12 },
  card: { marginHorizontal: 20, gap: 12 },
  linkLabel: { fontSize: 10, letterSpacing: 2, color: 'rgba(255,255,255,0.28)', fontWeight: '700' },
  link: { color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 18 },
  primary: {
    alignSelf: 'flex-start',
    marginHorizontal: 20,
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryInCard: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryText: { color: '#0a0a0a', fontWeight: '800', fontSize: 13 },
  secondary: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  secondaryText: { color: 'rgba(255,255,255,0.75)', fontWeight: '700', fontSize: 13 },
  hint: { color: 'rgba(255,255,255,0.28)', fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', gap: 18, marginTop: 4 },
  quiet: { color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: '600' },
  danger: { color: '#fca5a5', fontSize: 13, fontWeight: '600' },
})
