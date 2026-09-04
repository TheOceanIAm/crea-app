import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  FlatList,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Plus,
  Trash2,
} from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import {
  PROJECT_STATUS_PILL,
  projectStatusDisplayLabel,
  projectStatusVariant,
} from '@/lib/projectStatusDisplay'
import { ProductionWeatherSection } from '@/components/project/ProductionWeatherSection'
import { ProjectOverviewAbout } from '@/components/project/ProjectOverviewAbout'
import { formatProjectBudgetLine } from '@/lib/budgetFormatting'

type TabId =
  | 'overview'
  | 'milestones'
  | 'production'
  | 'crew'
  | 'messages'
  | 'files'
  | 'review'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'production', label: 'Production' },
  { id: 'crew', label: 'Crew' },
  { id: 'messages', label: 'Messages' },
  { id: 'files', label: 'Files' },
  { id: 'review', label: 'Review' },
]

type ShotDemo = { id: string; scene: string; desc: string; lens: string; status: string }

const CREW_DEMO = [
  { name: 'Alex Rivera', role: 'Lead', call: '07:00', loc: 'Studio A' },
  { name: 'Jamie Chen', role: 'Crew', call: '07:30', loc: 'Studio A' },
]

const MESSAGES_DEMO = [
  { id: '1', mine: false, name: 'Alex', body: 'Camera package is on site.' },
  { id: '2', mine: true, name: 'You', body: 'Perfect — we roll at 08:00.' },
]

export function DevDemoProjectWorkspace() {
  const router = useRouter()
  const [tab, setTab] = useState<TabId>('overview')
  const [milestones, setMilestones] = useState([
    { id: 'm1', title: 'Tech scout', done: true },
    { id: 'm2', title: 'Shoot day 1', done: false },
    { id: 'm3', title: 'Rough cut review', done: false },
  ])
  const [shots, setShots] = useState<ShotDemo[]>([
    { id: 's1', scene: '1', desc: 'Establishing wide', lens: '24mm', status: 'done' },
    { id: 's2', scene: '2A', desc: 'Product hero', lens: '50mm', status: 'rolling' },
  ])
  const briefText = 'Key visual: warm, high contrast. Deliver 16:9 master.'
  const [newMilestoneTitle, setNewMilestoneTitle] = useState('')
  const [prodFeature, setProdFeature] = useState<null | 'weather' | 'shotlist' | 'call' | 'tasks' | 'equipment'>(null)
  const [demoTasks, setDemoTasks] = useState([
    { id: 't1', title: 'Confirm location access', notes: '', done: false },
  ])
  const [demoGear, setDemoGear] = useState([{ id: 'g1', name: 'Alexa Mini', qty: '1', notes: '' }])
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newGearName, setNewGearName] = useState('')

  useEffect(() => {
    if (tab !== 'production') setProdFeature(null)
  }, [tab])

  const doneShots = useMemo(() => shots.filter((s) => s.status === 'done' || s.status === 'pick').length, [shots])

  const demoOverviewBrief = useMemo(() => {
    const head =
      'Demo: 30s ACME product commercial — Berlin, in progress. Local preview only; nothing is saved to Supabase.'
    const t = briefText.trim()
    return t ? `${head}\n\nCreative direction:\n${t}` : head
  }, [briefText])

  const needsFlexTab =
    tab === 'messages' || tab === 'milestones' || tab === 'crew' || tab === 'files' || tab === 'production'

  const cycleShot = (id: string) => {
    const order = ['open', 'rolling', 'done', 'pick']
    setShots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s
        const i = order.indexOf(s.status)
        return { ...s, status: order[(i + 1) % order.length] }
      })
    )
  }

  const toggleMilestone = (id: string) => {
    setMilestones((prev) => prev.map((m) => (m.id === id ? { ...m, done: !m.done } : m)))
  }

  const addMilestone = () => {
    const t = newMilestoneTitle.trim()
    if (!t) return
    setMilestones((prev) => [...prev, { id: `m-${Date.now()}`, title: t, done: false }])
    setNewMilestoneTitle('')
  }

  const removeMilestone = (id: string, title: string) => {
    Alert.alert('Remove milestone', title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setMilestones((prev) => prev.filter((m) => m.id !== id)),
      },
    ])
  }

  const demoProjectStatus = 'in_progress'
  const demoPillTheme = PROJECT_STATUS_PILL[projectStatusVariant(demoProjectStatus)]

  const statsRow = (
    <View style={styles.statsRow}>
      <View style={styles.statCard}>
        <Text style={styles.statLabel}>Applicants</Text>
        <Text style={styles.statValue}>2</Text>
        <Text style={styles.statSub}>demo</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={styles.statLabel}>Milestones</Text>
        <Text style={styles.statValue}>
          {milestones.filter((m) => m.done).length}/{milestones.length}
        </Text>
        <Text style={styles.statSub}>completed</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={styles.statLabel}>Budget</Text>
        <Text style={styles.statValueBudget} numberOfLines={2}>
          {formatProjectBudgetLine({
            budget_amount: 12500,
            budget_type: 'fixed',
            budget_currency: 'EUR',
          })}
        </Text>
        <Text style={styles.statSub}>total</Text>
      </View>
      <View style={styles.statCard}>
        <Text style={styles.statLabel}>Status</Text>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: demoPillTheme.backgroundColor,
              borderColor: demoPillTheme.borderColor,
            },
          ]}
        >
          <Text style={[styles.statusPillText, { color: demoPillTheme.color }]}>
            {projectStatusDisplayLabel(demoProjectStatus)}
          </Text>
        </View>
        <Text style={styles.statSub}>Berlin</Text>
      </View>
    </View>
  )

  const banner = (
    <View style={styles.devBanner}>
      <Text style={styles.devBannerText}>
        DEV demo workspace — local UI only, nothing is saved to Supabase. To test Production against your
        database, set EXPO_PUBLIC_DEMO_PROJECT_ID to a real project UUID in .env.local and open /project/demo again.
      </Text>
    </View>
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topRow}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Demo — ACME Commercial
        </Text>
      </View>

      {banner}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
        <View style={styles.tabRow}>
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => setTab(t.id)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </ScrollView>

      <View style={styles.bodyWrap}>
        {needsFlexTab ? (
          <View style={styles.flexFill}>
            <View style={styles.flexTabInner}>
              {tab === 'messages' && (
                <FlatList
                  style={styles.list}
                  data={MESSAGES_DEMO}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.msgList}
                  renderItem={({ item }) => (
                    <View style={[styles.bubbleWrap, item.mine && styles.bubbleWrapMine]}>
                      <Text style={styles.meta}>
                        {item.name}
                        {item.mine ? ' · you' : ''}
                      </Text>
                      <View style={[styles.bubble, item.mine && styles.bubbleMine]}>
                        <Text style={[styles.bubbleText, item.mine && styles.bubbleTextMine]}>{item.body}</Text>
                      </View>
                    </View>
                  )}
                />
              )}
              {tab === 'milestones' && (
                <ScrollView style={styles.scroll} contentContainerStyle={styles.pad} showsVerticalScrollIndicator={false}>
                  <Text style={styles.hint}>
                    Same as for company/lead in a real project: add or remove milestones. Crew sees the list and can
                    check items off.
                  </Text>
                  <View style={styles.addRow}>
                    <TextInput
                      style={styles.addInput}
                      placeholder="New milestone…"
                      placeholderTextColor="rgba(255,255,255,0.25)"
                      value={newMilestoneTitle}
                      onChangeText={setNewMilestoneTitle}
                      onSubmitEditing={addMilestone}
                    />
                    <TouchableOpacity style={styles.addBtn} onPress={addMilestone}>
                      <Plus size={22} color="#0a0a0a" strokeWidth={ICON_STROKE} />
                    </TouchableOpacity>
                  </View>
                  {milestones.length === 0 ? (
                    <Text style={styles.emptyM}>No milestones yet — add one above.</Text>
                  ) : (
                    milestones.map((m) => (
                      <View key={m.id} style={styles.mRow}>
                        <TouchableOpacity style={styles.checkWrap} onPress={() => toggleMilestone(m.id)}>
                          {m.done ? (
                            <View style={styles.checkOn}>
                              <Check size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
                            </View>
                          ) : (
                            <View style={styles.checkOff} />
                          )}
                        </TouchableOpacity>
                        <Text style={[styles.mTitle, m.done && styles.mTitleDone]}>{m.title}</Text>
                        <TouchableOpacity onPress={() => removeMilestone(m.id, m.title)} hitSlop={8}>
                          <Trash2 size={18} color="rgba(255,255,255,0.25)" strokeWidth={ICON_STROKE} />
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </ScrollView>
              )}
              {tab === 'crew' && (
                <ScrollView style={styles.scroll} contentContainerStyle={styles.pad}>
                  {CREW_DEMO.map((c) => (
                    <View key={c.name} style={styles.crewRow}>
                      <View>
                        <Text style={styles.crewName}>{c.name}</Text>
                        <Text style={styles.crewRole}>{c.role}</Text>
                      </View>
                      <Text style={styles.crewMeta}>
                        {c.call} · {c.loc}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              )}
              {tab === 'files' && (
                <View style={styles.placeholderBox}>
                  <Text style={styles.placeholderText}>
                    Files tab — contracts & PDFs in a real project (demo preview).
                  </Text>
                </View>
              )}
              {tab === 'production' && (
                <View style={styles.prodRoot}>
                  {prodFeature === null ? (
                    <ScrollView style={styles.scroll} contentContainerStyle={styles.pad} showsVerticalScrollIndicator={false}>
                      <Text style={styles.hint}>
                        Tap a category to open the feature — same layout as the live Production tab.
                      </Text>
                      <TouchableOpacity
                        style={styles.prodCategoryCard}
                        onPress={() => setProdFeature('weather')}
                        activeOpacity={0.88}
                      >
                        <View style={styles.prodCategoryText}>
                          <Text style={styles.prodCategoryTitle}>Weather</Text>
                          <Text style={styles.prodCategorySub}>7-day forecast for the shoot location</Text>
                        </View>
                        <ChevronRight size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.prodCategoryCard}
                        onPress={() => setProdFeature('shotlist')}
                        activeOpacity={0.88}
                      >
                        <View style={styles.prodCategoryText}>
                          <Text style={styles.prodCategoryTitle}>Shotlist</Text>
                          <Text style={styles.prodCategorySub}>Scene-by-scene list and status (demo)</Text>
                        </View>
                        <ChevronRight size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.prodCategoryCard}
                        onPress={() => setProdFeature('call')}
                        activeOpacity={0.88}
                      >
                        <View style={styles.prodCategoryText}>
                          <Text style={styles.prodCategoryTitle}>Call Sheet</Text>
                          <Text style={styles.prodCategorySub}>Crew calls and locations (demo)</Text>
                        </View>
                        <ChevronRight size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.prodCategoryCard}
                        onPress={() => setProdFeature('tasks')}
                        activeOpacity={0.88}
                      >
                        <View style={styles.prodCategoryText}>
                          <Text style={styles.prodCategoryTitle}>Tasks</Text>
                          <Text style={styles.prodCategorySub}>Manual checklist (demo)</Text>
                        </View>
                        <ChevronRight size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.prodCategoryCard}
                        onPress={() => setProdFeature('equipment')}
                        activeOpacity={0.88}
                      >
                        <View style={styles.prodCategoryText}>
                          <Text style={styles.prodCategoryTitle}>Equipment</Text>
                          <Text style={styles.prodCategorySub}>Manual kit list (demo)</Text>
                        </View>
                        <ChevronRight size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                      </TouchableOpacity>
                    </ScrollView>
                  ) : (
                    <View style={styles.prodDetailRoot}>
                      <View style={styles.prodDetailHeader}>
                        <TouchableOpacity style={styles.prodBackRow} onPress={() => setProdFeature(null)} hitSlop={10}>
                          <ChevronLeft size={22} color="#FFDC00" strokeWidth={ICON_STROKE} />
                          <Text style={styles.prodBackText}>Categories</Text>
                        </TouchableOpacity>
                        <Text style={styles.prodDetailTitle} numberOfLines={1}>
                          {prodFeature === 'weather'
                            ? 'Weather'
                            : prodFeature === 'shotlist'
                              ? 'Shotlist'
                              : prodFeature === 'call'
                                ? 'Call Sheet'
                                : prodFeature === 'tasks'
                                  ? 'Tasks'
                                  : 'Equipment'}
                        </Text>
                      </View>
                      <ScrollView style={styles.scroll} contentContainerStyle={styles.pad} showsVerticalScrollIndicator={false}>
                        {prodFeature === 'weather' ? <ProductionWeatherSection initialLocation="Berlin" /> : null}
                        {prodFeature === 'shotlist' ? (
                          <>
                            <Text style={[styles.sectionHead, styles.sectionSp]}>SHOT LIST (demo)</Text>
                            <Text style={styles.subtle}>
                              {doneShots} / {shots.length} shots marked done/pick
                            </Text>
                            {shots.map((s, idx) => (
                              <View key={s.id} style={styles.shotRow}>
                                <Text style={styles.shotIdx}>{idx + 1}</Text>
                                <View style={styles.shotCol}>
                                  <Text style={styles.shotLine}>
                                    Sc. {s.scene} — {s.desc}
                                  </Text>
                                  <Text style={styles.shotLens}>{s.lens}</Text>
                                </View>
                                <TouchableOpacity style={styles.prodShotStatusBtn} onPress={() => cycleShot(s.id)}>
                                  <Text style={styles.prodShotStatusText}>{s.status}</Text>
                                </TouchableOpacity>
                              </View>
                            ))}
                          </>
                        ) : null}
                        {prodFeature === 'call' ? (
                          <>
                            <Text style={[styles.sectionHead, styles.sectionSp]}>CALL SHEET (demo)</Text>
                            {CREW_DEMO.map((c) => (
                              <Text key={c.name} style={styles.line}>
                                {c.name} · {c.role} · {c.call}
                              </Text>
                            ))}
                          </>
                        ) : null}
                        {prodFeature === 'tasks' ? (
                          <>
                            <Text style={styles.hint}>Checklist for this production. Shared with the whole team.</Text>
                            <TextInput
                              style={styles.briefInput}
                              placeholder="Task"
                              placeholderTextColor="rgba(255,255,255,0.25)"
                              value={newTaskTitle}
                              onChangeText={setNewTaskTitle}
                              onSubmitEditing={() => {
                                const t = newTaskTitle.trim()
                                if (!t) return
                                setDemoTasks((prev) => [...prev, { id: `t-${Date.now()}`, title: t, notes: '', done: false }])
                                setNewTaskTitle('')
                              }}
                            />
                            {demoTasks.map((row) => (
                              <TouchableOpacity
                                key={row.id}
                                style={styles.shotRow}
                                onPress={() =>
                                  setDemoTasks((prev) =>
                                    prev.map((r) => (r.id === row.id ? { ...r, done: !r.done } : r))
                                  )
                                }
                              >
                                <Text style={[styles.shotLine, row.done && { textDecorationLine: 'line-through', opacity: 0.45 }]}>
                                  {row.done ? '✓  ' : '○  '}
                                  {row.title}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </>
                        ) : null}
                        {prodFeature === 'equipment' ? (
                          <>
                            <Text style={styles.hint}>Kit list for this production. Shared with the whole team.</Text>
                            <TextInput
                              style={styles.briefInput}
                              placeholder="Item"
                              placeholderTextColor="rgba(255,255,255,0.25)"
                              value={newGearName}
                              onChangeText={setNewGearName}
                              onSubmitEditing={() => {
                                const t = newGearName.trim()
                                if (!t) return
                                setDemoGear((prev) => [...prev, { id: `g-${Date.now()}`, name: t, qty: '', notes: '' }])
                                setNewGearName('')
                              }}
                            />
                            {demoGear.map((row) => (
                              <Text key={row.id} style={styles.line}>
                                {row.name}
                                {row.qty ? ` · ${row.qty}` : ''}
                              </Text>
                            ))}
                          </>
                        ) : null}
                      </ScrollView>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
            {tab === 'overview' ? statsRow : null}
            {tab === 'overview' && (
              <>
                <ProjectOverviewAbout briefContext={demoOverviewBrief} />
                <Text style={styles.para}>
                  This is a development-only workspace preview. Use tabs above to explore layout and flows without
                  creating database rows.
                </Text>
              </>
            )}
            {tab === 'review' && (
              <View style={styles.placeholderBox}>
                <Text style={styles.placeholderText}>
                  Frame.io and PicDrop links would appear here for a real project (company / lead can edit).
                </Text>
              </View>
            )}

          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0a0a0a' },
  devBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(55,138,221,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(55,138,221,0.35)',
  },
  devBannerText: { fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 17 },
  bodyWrap: { flex: 1, paddingHorizontal: 16 },
  flexFill: { flex: 1 },
  flexTabInner: { flex: 1, minHeight: 0 },
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
  bodyContent: { paddingBottom: 40 },
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
  statValueBudget: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFDC00',
    lineHeight: 20,
  },
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 100,
    borderWidth: 1,
    marginTop: 2,
    marginBottom: 2,
  },
  statusPillText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  statSub: { fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 4 },
  para: { fontSize: 14, color: 'rgba(255,255,255,0.45)', lineHeight: 20, marginBottom: 12 },
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
  outputBox: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 20,
  },
  outputLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 1.2,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
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
  genBtn: {
    backgroundColor: '#FFDC00',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  genBtnText: { color: '#0a0a0a', fontWeight: '800' },
  demoSyncBox: {
    marginTop: 20,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#141414',
  },
  demoSyncTitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  demoSyncText: { fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 18 },
  placeholderBox: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    minHeight: 200,
  },
  placeholderText: { fontSize: 14, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 20 },
  scroll: { flex: 1 },
  pad: { paddingBottom: 32 },
  hint: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 16, lineHeight: 18 },
  prodRoot: { flex: 1, minHeight: 0 },
  prodCategoryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 12,
  },
  prodCategoryText: { flex: 1 },
  prodCategoryTitle: { fontSize: 17, fontWeight: '800', color: '#fff', marginBottom: 4 },
  prodCategorySub: { fontSize: 13, color: 'rgba(255,255,255,0.42)', lineHeight: 18 },
  prodDetailRoot: { flex: 1, minHeight: 0 },
  prodDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  prodBackRow: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  prodBackText: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  prodDetailTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'right',
  },
  list: { flex: 1 },
  msgList: { paddingBottom: 12, paddingTop: 8 },
  bubbleWrap: { alignSelf: 'flex-start', maxWidth: '88%', marginBottom: 12 },
  bubbleWrapMine: { alignSelf: 'flex-end' },
  meta: { fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 4, marginLeft: 4 },
  bubble: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bubbleMine: { backgroundColor: 'rgba(255,220,0,0.15)', borderColor: 'rgba(255,220,0,0.35)' },
  bubbleText: { fontSize: 15, color: 'rgba(255,255,255,0.9)', lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  mRow: {
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
  mTitle: { flex: 1, fontSize: 15, color: 'rgba(255,255,255,0.9)' },
  mTitleDone: { textDecorationLine: 'line-through', color: 'rgba(255,255,255,0.35)' },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  addInput: {
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
  emptyM: { fontSize: 14, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },
  crewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  crewName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  crewRole: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 },
  crewMeta: { fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  sectionHead: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.2,
    marginTop: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  sectionSp: { marginTop: 28 },
  subtle: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 12 },
  shotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  shotIdx: { width: 24, textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  shotCol: { flex: 1 },
  shotLine: { fontSize: 14, color: 'rgba(255,255,255,0.9)' },
  shotLens: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 },
  prodShotStatusBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#378ADD',
  },
  prodShotStatusText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  line: { fontSize: 14, color: 'rgba(255,255,255,0.75)', marginBottom: 8 },
})
