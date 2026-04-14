import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  ChevronLeft,
  Clapperboard,
  ClipboardList,
  Phone,
  Video,
  Sparkles,
} from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'
import { getCreaWebBaseUrl, openProjectOnWeb } from '@/lib/creaWeb'

type TabId =
  | 'overview'
  | 'milestones'
  | 'crew'
  | 'messages'
  | 'files'
  | 'frameio'
  | 'brief'

type ProjectRow = {
  id: string
  job_id: string | null
  company_id: string
  freelancer_id: string
  title: string
  status: string
  budget_amount: number | null
  budget_type: string | null
  location: string | null
  milestones_completed: number
  milestones_total: number
  brief_ai_context: string | null
}

const TABS: { id: TabId; label: string; web?: boolean }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'crew', label: 'Crew' },
  { id: 'messages', label: 'Messages' },
  { id: 'files', label: 'Files' },
  { id: 'frameio', label: 'Frame.io', web: true },
  { id: 'brief', label: 'Brief AI' },
]

const TOOLS: { id: string; title: string; sub: string; icon: LucideIcon }[] = [
  { id: 'shotlist', title: 'Shotlist', sub: 'Shot-by-shot breakdown.', icon: Clapperboard },
  { id: 'tasks', title: 'Task breakdown', sub: 'Phases & responsibilities.', icon: ClipboardList },
  { id: 'callsheet', title: 'Call sheet', sub: 'Crew, times & locations.', icon: Phone },
  { id: 'gear', title: 'Equipment list', sub: 'Cameras, lights, grip & more.', icon: Video },
]

export default function ProjectWorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [applicants, setApplicants] = useState(0)
  const [tab, setTab] = useState<TabId>('brief')
  const [tool, setTool] = useState<string>('tasks')
  const [briefText, setBriefText] = useState('')
  const [savingBrief, setSavingBrief] = useState(false)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') {
      setLoading(false)
      return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setForbidden(true)
      setLoading(false)
      return
    }

    const { data: row, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
    if (error || !row) {
      setForbidden(true)
      setProject(null)
      setLoading(false)
      return
    }

    const p = row as ProjectRow
    if (p.company_id !== user.id && p.freelancer_id !== user.id) {
      setForbidden(true)
      setProject(null)
      setLoading(false)
      return
    }

    setProject(p)
    setBriefText(p.brief_ai_context ?? '')
    setForbidden(false)

    if (p.job_id) {
      const { count } = await supabase
        .from('job_applications')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', p.job_id)
      setApplicants(count ?? 0)
    } else {
      setApplicants(0)
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const budgetLine = useMemo(() => {
    if (!project?.budget_amount) return '—'
    const n = project.budget_amount.toLocaleString('en-US')
    const t = (project.budget_type || 'fixed').toUpperCase()
    return `${n} ${t}`
  }, [project])

  const saveBrief = async () => {
    if (!project) return
    setSavingBrief(true)
    const { error } = await supabase
      .from('projects')
      .update({ brief_ai_context: briefText.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', project.id)
    setSavingBrief(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    setProject((prev) => (prev ? { ...prev, brief_ai_context: briefText.trim() || null } : prev))
  }

  const onGenerate = async () => {
    const web = getCreaWebBaseUrl()
    if (!project) return
    setGenerating(true)
    await saveBrief()
    setGenerating(false)
    if (web) {
      openProjectOnWeb(project.id, '?tool=brief')
      Alert.alert(
        'Continue on web',
        'Full AI generation runs in the Crea web app. We opened it in your browser.'
      )
    } else {
      Alert.alert(
        'Web workspace',
        'Add EXPO_PUBLIC_CREA_WEB_URL to your .env to open the web Brief AI workspace.'
      )
    }
  }

  const openWebTab = (kind: string) => {
    if (!project) return
    const base = getCreaWebBaseUrl()
    if (!base) {
      Alert.alert('Web URL missing', 'Set EXPO_PUBLIC_CREA_WEB_URL in .env.')
      return
    }
    Linking.openURL(`${base}/projects/${project.id}?view=${encodeURIComponent(kind)}`).catch(() => {})
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" size="large" />
      </View>
    )
  }

  if (forbidden || !project) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>Close</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.miss}>You don’t have access to this project.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {project.title}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
        <View style={styles.tabRow}>
          {TABS.map((t) => {
            const active = tab === t.id
            const isBrief = t.id === 'brief'
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => {
                  setTab(t.id)
                  if (t.web && project) openWebTab(t.id)
                }}
                style={[styles.tab, active && styles.tabActive]}
              >
                {isBrief ? (
                  <View style={styles.tabInner}>
                    <Sparkles size={12} color={active ? '#0a0a0a' : '#FFDC00'} strokeWidth={ICON_STROKE} />
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                  </View>
                ) : (
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
                )}
              </TouchableOpacity>
            )
          })}
        </View>
      </ScrollView>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Applicants</Text>
            <Text style={styles.statValue}>{applicants}</Text>
            <Text style={styles.statSub}>in crew pipeline</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Milestones</Text>
            <Text style={styles.statValue}>
              {project.milestones_completed}/{project.milestones_total}
            </Text>
            <Text style={styles.statSub}>completed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Budget</Text>
            <Text style={styles.statValue} numberOfLines={1}>
              {budgetLine}
            </Text>
            <Text style={styles.statSub}>total</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Status</Text>
            <Text style={styles.statValueSmall}>{project.status.toUpperCase()}</Text>
            <Text style={styles.statSub}>{project.location || '—'}</Text>
          </View>
        </View>

        {tab === 'overview' && (
          <Text style={styles.para}>
            Use the tabs above for milestones, crew chat, files, and Frame.io. Brief AI and deep document tools sync
            with the Crea web workspace when EXPO_PUBLIC_CREA_WEB_URL is set.
          </Text>
        )}

        {(tab === 'messages' || tab === 'files' || tab === 'milestones' || tab === 'crew') && (
          <View style={styles.webCallout}>
            <Text style={styles.para}>
              {tab === 'messages' && 'Threaded project chat is available in the web app.'}
              {tab === 'files' && 'Upload and version files in the web workspace.'}
              {tab === 'milestones' && 'Edit milestone boards on the web; counts sync here.'}
              {tab === 'crew' && 'Manage crew roles and invites on the web.'}
            </Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => openWebTab(tab)}>
              <Text style={styles.secondaryBtnText}>Open on web</Text>
            </TouchableOpacity>
          </View>
        )}

        {tab === 'brief' && (
          <>
            <Text style={styles.sectionLabel}>Production documents</Text>
            <View style={styles.toolGrid}>
              {TOOLS.map((x) => {
                const Icon = x.icon
                const active = tool === x.id
                return (
                  <TouchableOpacity
                    key={x.id}
                    style={[styles.toolCard, active && styles.toolCardActive]}
                    onPress={() => setTool(x.id)}
                  >
                    <Icon size={26} color="#ffffff" strokeWidth={ICON_STROKE} />
                    <Text style={styles.toolTitle}>{x.title}</Text>
                    <Text style={styles.toolSub}>{x.sub}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <TouchableOpacity
              style={[styles.secondaryBtn, styles.toolWebBtn]}
              onPress={() => openWebTab(`tool-${tool}`)}
            >
              <Text style={styles.secondaryBtnText}>
                Open “{TOOLS.find((t) => t.id === tool)?.title ?? 'Tool'}” on web
              </Text>
            </TouchableOpacity>

            <Text style={styles.contextLabel}>
              ADDITIONAL CONTEXT <Text style={styles.optional}>(optional)</Text>
            </Text>
            <TextInput
              style={styles.briefInput}
              multiline
              placeholder="Describe creative direction, references, deliverables, schedule…"
              placeholderTextColor="rgba(255,255,255,0.25)"
              value={briefText}
              onChangeText={setBriefText}
              textAlignVertical="top"
            />
            <View style={styles.briefActions}>
              <TouchableOpacity
                style={[styles.saveBtn, savingBrief && styles.btnDim]}
                onPress={saveBrief}
                disabled={savingBrief}
              >
                <Text style={styles.saveBtnText}>{savingBrief ? 'Saving…' : 'Save context'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.genBtn, generating && styles.btnDim]}
                onPress={onGenerate}
                disabled={generating}
              >
                {generating ? (
                  <ActivityIndicator color="#0a0a0a" />
                ) : (
                  <Text style={styles.genBtnText}>Generate on web</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 16 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 12 },
  backLabel: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  tabScroll: { maxHeight: 48, marginBottom: 8 },
  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#141414',
  },
  tabActive: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  tabTextActive: { color: '#0a0a0a' },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 16, paddingBottom: 40 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  statCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  statLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  statValue: { fontSize: 22, fontWeight: '900', color: '#FFDC00' },
  statValueSmall: { fontSize: 14, fontWeight: '900', color: '#FFDC00' },
  statSub: { fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 4 },
  sectionLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.5,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  toolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  toolCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  toolCardActive: { borderColor: 'rgba(255,220,0,0.55)' },
  toolTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  toolSub: { fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 16 },
  contextLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  optional: { fontStyle: 'italic', letterSpacing: 0 },
  briefInput: {
    minHeight: 160,
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  briefActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  saveBtnText: { color: 'rgba(255,255,255,0.75)', fontWeight: '700' },
  genBtn: {
    flex: 1,
    minWidth: 160,
    backgroundColor: '#FFDC00',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  genBtnText: { color: '#0a0a0a', fontWeight: '800' },
  btnDim: { opacity: 0.6 },
  para: { fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 20, marginBottom: 12 },
  webCallout: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  toolWebBtn: { marginBottom: 20 },
  secondaryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
  },
  secondaryBtnText: { color: '#FFDC00', fontWeight: '700' },
  miss: { color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
})
