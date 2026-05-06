import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Switch,
  TextInput,
  RefreshControl,
  Linking,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, ExternalLink } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { useCeoAccess } from '@/lib/useCeoAccess'
import { getCreaWebBaseUrl } from '@/lib/creaWeb'

type PlatformSettings = {
  ok: boolean
  maintenance_mode: boolean
  registration_open: boolean
  display_vat_rate: number
  announcement_public: string
  updated_at: string | null
  error?: string
  hint?: string
}

function parseSettings(raw: unknown): PlatformSettings {
  const empty: PlatformSettings = {
    ok: false,
    maintenance_mode: false,
    registration_open: true,
    display_vat_rate: 0.19,
    announcement_public: '',
    updated_at: null,
  }
  if (!raw || typeof raw !== 'object') return empty
  const o = raw as Record<string, unknown>
  return {
    ok: o.ok === true,
    maintenance_mode: o.maintenance_mode === true,
    registration_open: o.registration_open !== false,
    display_vat_rate: typeof o.display_vat_rate === 'number' ? o.display_vat_rate : 0.19,
    announcement_public: typeof o.announcement_public === 'string' ? o.announcement_public : '',
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : null,
    error: typeof o.error === 'string' ? o.error : undefined,
    hint: typeof o.hint === 'string' ? o.hint : undefined,
  }
}

function rateToPercentInput(rate: number): string {
  const p = Math.round(rate * 10000) / 100
  if (Number.isInteger(p)) return String(p)
  return String(p)
}

function parsePercentInput(s: string): number | null {
  const t = s.replace(',', '.').trim()
  if (t === '') return null
  const n = Number(t)
  if (Number.isNaN(n) || n < 0 || n > 100) return null
  return n / 100
}

/** PostgREST / Supabase when RPC was never deployed or cache stale */
function explainSettingsRpcError(raw: string): string {
  const m = raw.toLowerCase()
  if (
    m.includes('ceo_get_platform_settings') ||
    m.includes('ceo_patch_platform_settings') ||
    m.includes('schema cache')
  ) {
    return [
      'Platform settings RPCs are missing in Supabase, or the API schema cache is stale.',
      '',
      '1) Supabase → SQL Editor → run the full file:',
      '   supabase/sql/ceo_platform_settings_install.sql',
      '(Creates the table + RPCs; requires _ceo_is_caller from ceo_admin_rpcs.sql.)',
      '',
      '2) Reload the app (pull to refresh on this screen).',
      '',
      'Technical message: ' + raw,
    ].join('\n')
  }
  return raw
}

export default function CeoSettingsScreen() {
  const router = useRouter()
  const { ready, allowed } = useCeoAccess()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [settings, setSettings] = useState<PlatformSettings | null>(null)

  const [maintenance, setMaintenance] = useState(false)
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [vatInput, setVatInput] = useState('19')
  const [announcementDraft, setAnnouncementDraft] = useState('')

  const webBase = getCreaWebBaseUrl()

  const applyParsed = useCallback((p: PlatformSettings) => {
    setSettings(p)
    setMaintenance(p.maintenance_mode)
    setRegistrationOpen(p.registration_open)
    setVatInput(rateToPercentInput(p.display_vat_rate))
    setAnnouncementDraft(p.announcement_public)
  }, [])

  const load = useCallback(
    async (isRefresh?: boolean) => {
      if (!allowed) return
      if (isRefresh) setRefreshing(true)
      else setLoading(true)
      setHint(null)
      const { data, error } = await supabase.rpc('ceo_get_platform_settings')
      setLoading(false)
      setRefreshing(false)
      if (error) {
        setHint(explainSettingsRpcError(error.message))
        setSettings(null)
        return
      }
      const p = parseSettings(data)
      if (!p.ok) {
        setHint(p.hint || p.error || 'Could not load settings.')
        setSettings(null)
        return
      }
      applyParsed(p)
    },
    [allowed, applyParsed]
  )

  useEffect(() => {
    if (ready && allowed) load()
  }, [ready, allowed, load])

  const patch = useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true)
    const { data, error } = await supabase.rpc('ceo_patch_platform_settings', { p_patch: patch })
    setSaving(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    const p = parseSettings(data)
    if (!p.ok) {
      Alert.alert('Save failed', p.hint || p.error || 'Unknown error')
      return
    }
    applyParsed(p)
  }, [applyParsed])

  const onToggleMaintenance = (v: boolean) => {
    setMaintenance(v)
    patch({ maintenance_mode: v })
  }

  const onToggleRegistration = (v: boolean) => {
    setRegistrationOpen(v)
    patch({ registration_open: v })
  }

  const saveVat = () => {
    const rate = parsePercentInput(vatInput)
    if (rate === null) {
      Alert.alert('VAT', 'Enter a number between 0 and 100 (e.g. 19).')
      return
    }
    patch({ display_vat_rate: rate })
  }

  const saveAnnouncement = () => {
    patch({ announcement_public: announcementDraft })
  }

  const openWeb = (path: string) => {
    if (!webBase) {
      Alert.alert('Web URL', 'Set EXPO_PUBLIC_CREA_WEB_URL in your .env file.')
      return
    }
    const p = path.startsWith('/') ? path : `/${path}`
    Linking.openURL(`${webBase}${p}`).catch(() => {})
  }

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
          <Text style={styles.deniedSub}>CEO accounts only.</Text>
        </View>
      </SafeAreaView>
    )
  }

  const updatedLabel =
    settings?.updated_at != null
      ? new Date(settings.updated_at).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TouchableOpacity style={styles.backRow} onPress={() => router.back()} hitSlop={12}>
        <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backText}>Dashboard</Text>
      </TouchableOpacity>

      <Text style={styles.kicker}>PLATFORM</Text>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>
        Platform controls — same as the control panel. Changes are stored when you save. The app only enforces flags
        for registration or login once you wire that up in the client.
      </Text>

      {hint ? (
        <View style={styles.hintBox}>
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      ) : null}

      {loading && !settings ? (
        <View style={styles.listPad}>
          <ActivityIndicator color="#FFDC00" />
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#FFDC00" />
        }
      >
        {settings?.ok ? (
          <>
            <Text style={styles.sectionTitle}>Platform</Text>
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Maintenance mode</Text>
                  <Text style={styles.rowSub}>Show a notice and restrict sign-in (implement in the client).</Text>
                </View>
                <Switch
                  value={maintenance}
                  onValueChange={onToggleMaintenance}
                  disabled={saving}
                  trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                  thumbColor={maintenance ? '#FFDC00' : '#888'}
                />
              </View>
              <View style={styles.divider} />
              <View style={styles.rowBetween}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Registration open</Text>
                  <Text style={styles.rowSub}>Allow new accounts (stored in the DB; enforce e.g. in an Edge Function).</Text>
                </View>
                <Switch
                  value={registrationOpen}
                  onValueChange={onToggleRegistration}
                  disabled={saving}
                  trackColor={{ false: '#333', true: 'rgba(255,220,0,0.35)' }}
                  thumbColor={registrationOpen ? '#FFDC00' : '#888'}
                />
              </View>
            </View>

            <Text style={styles.sectionTitle}>Tax &amp; display</Text>
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>VAT rate for display (%)</Text>
              <Text style={styles.fieldHint}>Enter 0–100; stored internally as a decimal (e.g. 19 → 0.19).</Text>
              <TextInput
                style={styles.input}
                value={vatInput}
                onChangeText={setVatInput}
                keyboardType="decimal-pad"
                placeholder="19"
                placeholderTextColor="rgba(255,255,255,0.28)"
              />
              <TouchableOpacity style={styles.primaryBtn} onPress={saveVat} disabled={saving} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save VAT rate'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Public notices</Text>
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>Announcement line (optional)</Text>
              <Text style={styles.fieldHint}>Short text for a banner in the app or website (wire up in the client).</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={announcementDraft}
                onChangeText={setAnnouncementDraft}
                placeholder="e.g. Scheduled maintenance Sunday 10pm–midnight"
                placeholderTextColor="rgba(255,255,255,0.28)"
                multiline
              />
              <TouchableOpacity style={styles.secondaryBtn} onPress={saveAnnouncement} disabled={saving} activeOpacity={0.85}>
                <Text style={styles.secondaryBtnText}>Save announcement</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Links</Text>
            <View style={styles.card}>
              <LinkRow
                label="Website / admin"
                sub={webBase || 'EXPO_PUBLIC_CREA_WEB_URL is not set'}
                onPress={() => (webBase ? Linking.openURL(webBase).catch(() => {}) : undefined)}
                disabled={!webBase}
              />
              <View style={styles.divider} />
              <LinkRow
                label="Privacy policy"
                sub={`${webBase || '…'}/datenschutz`}
                onPress={() => openWeb('/datenschutz')}
                disabled={!webBase}
              />
              <View style={styles.divider} />
              <LinkRow
                label="Imprint"
                sub={`${webBase || '…'}/impressum`}
                onPress={() => openWeb('/impressum')}
                disabled={!webBase}
              />
            </View>

            {updatedLabel ? (
              <Text style={styles.footerMeta}>Last updated: {updatedLabel}</Text>
            ) : null}
          </>
        ) : !loading ? (
          <Text style={styles.empty}>No settings loaded.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function LinkRow({
  label,
  sub,
  onPress,
  disabled,
}: {
  label: string
  sub: string
  onPress?: () => void
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.linkRow, disabled && styles.linkRowDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={styles.linkRowText}>
        <Text style={styles.linkRowLabel}>{label}</Text>
        <Text style={styles.linkRowSub} numberOfLines={2}>
          {sub}
        </Text>
      </View>
      <ExternalLink size={18} color={disabled ? 'rgba(255,255,255,0.2)' : '#FFDC00'} strokeWidth={ICON_STROKE} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a', paddingHorizontal: 20 },
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 10, alignSelf: 'flex-start' },
  backText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 2,
    marginBottom: 6,
  },
  title: { fontSize: 26, fontWeight: '900', color: '#ffffff', marginBottom: 8 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.42)', lineHeight: 19, marginBottom: 14 },
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
  scrollContent: { paddingBottom: 48 },
  sectionTitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 10,
    marginTop: 6,
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.92)' },
  rowSub: { fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 4, lineHeight: 17 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 14,
  },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.85)', marginBottom: 6 },
  fieldHint: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 10, lineHeight: 16 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 15,
    marginBottom: 12,
  },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  primaryBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '800' },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
  },
  secondaryBtnText: { color: '#FFDC00', fontSize: 15, fontWeight: '700' },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  linkRowDisabled: { opacity: 0.45 },
  linkRowText: { flex: 1 },
  linkRowLabel: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  linkRowSub: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
  footerMeta: { fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 8, textAlign: 'center' },
  empty: { color: 'rgba(255,255,255,0.35)', fontSize: 14, textAlign: 'center', marginTop: 24 },
  deniedTitle: { fontSize: 18, fontWeight: '800', color: '#ffffff', marginBottom: 8 },
  deniedSub: { fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
})
