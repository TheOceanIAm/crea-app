import { Image, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ChevronLeft, ChevronRight, Globe, Instagram, MapPin, Share2, X } from 'lucide-react-native'
import type { AppStoreScreenshotId } from '@/lib/appStoreScreenshotCatalog'
import { ICON_STROKE } from '@/lib/iconTheme'

const AVATAR_CHRIS =
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face'
const AVATAR_JANA =
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face'
const AVATAR_2 =
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=face'
const AVATAR_3 =
  'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&crop=face'
const PORTFOLIO_1 =
  'https://images.unsplash.com/photo-1617788138017-80ad40651399?w=400&h=240&fit=crop'
const PORTFOLIO_2 =
  'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=400&h=240&fit=crop'

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>
}

function Chip({ label, active }: { label: string; active?: boolean }) {
  return (
    <View style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </View>
  )
}

function LogoMark({ letter, tint }: { letter: string; tint?: string }) {
  return (
    <View style={[styles.logoMark, tint ? { backgroundColor: tint } : null]}>
      <Text style={styles.logoLetter}>{letter}</Text>
    </View>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'green' | 'yellow' | 'red' }) {
  const toneStyle =
    tone === 'green' ? styles.pillGreen : tone === 'yellow' ? styles.pillYellow : styles.pillRed
  return (
    <View style={[styles.statusPill, toneStyle]}>
      <Text style={styles.statusPillText}>{label}</Text>
    </View>
  )
}

function ProfileScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
      <View style={styles.profileHeader}>
        <Image source={{ uri: AVATAR_CHRIS }} style={styles.avatarLg} />
        <Text style={styles.name}>Chris Noviak</Text>
        <Text style={styles.subtle}>Director</Text>
        <View style={styles.locationRow}>
          <MapPin size={14} color="rgba(255,255,255,0.45)" strokeWidth={ICON_STROKE} />
          <Text style={styles.subtle}>Berlin, Germany</Text>
        </View>
        <View style={styles.socialRow}>
          <View style={styles.socialBtn}>
            <Globe size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
          </View>
          <View style={styles.socialBtn}>
            <Instagram size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
          </View>
        </View>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>Freelancer</Text>
        </View>
        <Text style={styles.dayRate}>€1,400.00</Text>
        <Text style={styles.dayRateSub}>DAY RATE</Text>
        <View style={styles.shareRow}>
          <Share2 size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.shareText}>Share profile</Text>
        </View>
      </View>
      <SectionLabel>ABOUT</SectionLabel>
      <Text style={styles.bodyCopy}>
        15 years in commercial, music videos, and film. I lead from prep through delivery — calm on set,
        sharp in the edit.
      </Text>
      <SectionLabel>SKILLS</SectionLabel>
      <View style={styles.chipRow}>
        {['Direction', 'DoP', 'Production', 'Camera', 'Color Grading'].map((s) => (
          <Chip key={s} label={s} />
        ))}
      </View>
    </ScrollView>
  )
}

function InvoicesScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <Text style={styles.screenTitle}>INVOICES</Text>
        <View style={styles.primaryBtnSm}>
          <Text style={styles.primaryBtnSmText}>+ New</Text>
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <LogoMark letter="N" tint="#111" />
          <View style={styles.cardMain}>
            <Text style={styles.cardTitle}>Nike</Text>
            <Text style={styles.cardMeta}>#2026-047 · Brand Campaign</Text>
          </View>
          <Text style={styles.amount}>€4,200</Text>
        </View>
        <Text style={styles.cardDetail}>Service: DOP · 3 Shoot Days</Text>
        <Text style={styles.cardDetail}>Period: Jun 18–20, 2026</Text>
        <Text style={styles.cardDetail}>Total incl. VAT: €4,200.00</Text>
        <StatusPill label="Paid" tone="green" />
      </View>
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <LogoMark letter="S" tint="#1DB954" />
          <View style={styles.cardMain}>
            <Text style={styles.cardTitle}>Spotify</Text>
            <Text style={styles.cardMeta}>#2026-046 · Artist Documentary</Text>
          </View>
          <Text style={styles.amount}>€8,400</Text>
        </View>
        <StatusPill label="Open" tone="yellow" />
      </View>
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <LogoMark letter="M" tint="#041E42" />
          <View style={styles.cardMain}>
            <Text style={styles.cardTitle}>MLB Europe</Text>
            <Text style={styles.cardMeta}>#2026-041 · London Series</Text>
          </View>
          <Text style={styles.amount}>€5,400</Text>
        </View>
        <StatusPill label="Overdue" tone="red" />
      </View>
    </ScrollView>
  )
}

function PostProjectScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
      <View style={styles.backRow}>
        <ChevronLeft size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backYellow}>New Project</Text>
      </View>
      <SectionLabel>ROLES NEEDED</SectionLabel>
      <View style={styles.chipRow}>
        <Chip label="Direction" />
        <Chip label="Videography" />
        <Chip label="Photography" />
        <View style={styles.chipAdd}>
          <Text style={styles.chipAddText}>+</Text>
        </View>
      </View>
      <SectionLabel>BUDGET</SectionLabel>
      <View style={styles.chipRow}>
        <Chip label="Negotiable" active />
        <Chip label="Day rate" />
        <Chip label="Fixed budget" />
      </View>
      <SectionLabel>LOCATION</SectionLabel>
      <View style={styles.chipRow}>
        <Chip label="Remote" />
        <Chip label="On-site" />
        <Chip label="Hybrid" active />
      </View>
      <SectionLabel>PRODUCTION WINDOW</SectionLabel>
      <View style={styles.dateRow}>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>START</Text>
          <Text style={styles.datePlaceholder}>YYYY-MM-DD</Text>
        </View>
        <View style={styles.dateField}>
          <Text style={styles.dateLabel}>END</Text>
          <Text style={styles.datePlaceholder}>YYYY-MM-DD</Text>
        </View>
      </View>
      <SectionLabel>DESCRIPTION</SectionLabel>
      <View style={styles.textArea}>
        <Text style={styles.placeholder}>Deliverables, dates, kit, usage…</Text>
      </View>
      <View style={styles.primaryBtn}>
        <Text style={styles.primaryBtnText}>Publish project</Text>
      </View>
    </ScrollView>
  )
}

function ProjectTabs({ active }: { active: string }) {
  const tabs = ['Overview', 'Milestones', 'Production', 'Crew', 'Budget', 'Messages']
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
      <View style={styles.tabRow}>
        {tabs.map((t) => (
          <View key={t} style={[styles.tab, t === active && styles.tabActive]}>
            <Text style={[styles.tabText, t === active && styles.tabTextActive]}>{t}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

function ProjectOverviewScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
      <View style={styles.backRow}>
        <ChevronLeft size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backYellow}>Back</Text>
        <Text style={styles.projectTitle}>Brand Film</Text>
      </View>
      <ProjectTabs active="Overview" />
      <View style={styles.statGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>12</Text>
          <Text style={styles.statLabel}>in crew pipeline</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>3/6</Text>
          <Text style={styles.statLabel}>completed</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>€14,000 · FIXED</Text>
          <Text style={styles.statLabel}>total</Text>
        </View>
        <View style={styles.statCard}>
          <View style={styles.rolePill}>
            <Text style={styles.rolePillText}>Recruiting</Text>
          </View>
        </View>
      </View>
      <Text style={styles.blockTitle}>Project status</Text>
      <View style={styles.chipRow}>
        <Chip label="Recruiting" active />
        <Chip label="Active" />
        <Chip label="Completed" />
      </View>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>14 Jun 2026 → 21 Jun 2026 · 8 days</Text>
      </View>
      <Text style={styles.blockTitle}>About this project</Text>
      <View style={styles.aboutBox}>
        <Text style={styles.bodyCopy}>
          Hero brand film for summer launch. Need DOP + gaffer for studio and location days in Berlin.
        </Text>
        <Text style={[styles.sectionLabel, { marginTop: 12 }]}>DELIVERABLES</Text>
        <Text style={styles.bodyCopy}>1 × Brand Film 90 sec{'\n'}2 × Cut downs 15 sec</Text>
      </View>
    </ScrollView>
  )
}

function ProductionScreen() {
  const items = [
    ['Sun Planner', 'Sunrise, sunset, golden hour, and sun-angle preview for your shoot'],
    ['Weather', '7-day forecast for your shoot location'],
    ['Shotlist', 'Scene-by-scene list for the calendar day you load'],
    ['Call Sheet', 'Crew calls, locations, PDF export, and daily wrap'],
    ['Tasks', 'AI task breakdown synced to production context'],
    ['Equipment', 'AI equipment list synced to production context'],
  ]
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
      <View style={styles.backRow}>
        <ChevronLeft size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backYellow}>Back</Text>
        <Text style={styles.projectTitle}>Brand Film</Text>
      </View>
      <ProjectTabs active="Production" />
      <Text style={styles.hint}>
        Choose a category to open weather, shotlist, call sheet, tasks, or equipment. Visible to the whole team.
      </Text>
      {items.map(([title, sub]) => (
        <View key={title} style={styles.listCard}>
          <View style={styles.listCardText}>
            <Text style={styles.listCardTitle}>{title}</Text>
            <Text style={styles.listCardSub}>{sub}</Text>
          </View>
          <ChevronRight size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
        </View>
      ))}
    </ScrollView>
  )
}

function AvailabilityScreen() {
  const available = new Set([4, 5, 6, 13, 14, 15, 25, 26, 27, 29])
  const days = Array.from({ length: 31 }, (_, i) => i + 1)
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
      <View style={styles.portfolioRow}>
        <View style={styles.portfolioCard}>
          <Image source={{ uri: PORTFOLIO_1 }} style={styles.portfolioImg} />
          <Text style={styles.portfolioTitle}>Elara Automotive</Text>
          <Text style={styles.portfolioSub}>Brand Film</Text>
        </View>
        <View style={styles.portfolioCard}>
          <Image source={{ uri: PORTFOLIO_2 }} style={styles.portfolioImg} />
          <Text style={styles.portfolioTitle}>AETHER – Drift</Text>
          <Text style={styles.portfolioSub}>Music Video</Text>
        </View>
      </View>
      <View style={styles.availHeader}>
        <Text style={styles.blockTitle}>AVAILABILITY</Text>
        <Text style={styles.availFree}>10 days free</Text>
      </View>
      <Text style={styles.monthTitle}>MAY 2026</Text>
      <View style={styles.calendarGrid}>
        {days.map((d) => (
          <View key={d} style={[styles.calDay, available.has(d) && styles.calDayAvail]}>
            <Text style={[styles.calDayText, available.has(d) && styles.calDayTextAvail]}>{d}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.legend}>● Available  ● Busy  ● Off  ● Today</Text>
      <Text style={styles.linkYellow}>Browse more freelancers →</Text>
    </ScrollView>
  )
}

function TalentPoolScreen() {
  const rows = [
    {
      name: 'Chris Noviak',
      meta: 'Director · Berlin',
      rate: '€1,400/day',
      skills: ['Direction', 'DoP'],
      status: 'Available',
      tone: 'green' as const,
      avatar: AVATAR_CHRIS,
    },
    {
      name: 'Jana Maier',
      meta: 'DOP · Munich',
      rate: '€950/day',
      skills: ['DoP', 'ARRI'],
      status: 'Available',
      tone: 'green' as const,
      avatar: AVATAR_JANA,
    },
    {
      name: 'Tom Becker',
      meta: 'Producer · Hamburg',
      rate: '€1,100/day',
      skills: ['Production', 'Budget'],
      status: 'From Jun 15',
      tone: 'yellow' as const,
      avatar: AVATAR_2,
    },
    {
      name: 'Sofia Lind',
      meta: 'Editor · Remote',
      rate: '€650/day',
      skills: ['Post', 'DaVinci'],
      status: 'Available',
      tone: 'green' as const,
      avatar: AVATAR_3,
    },
  ]
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
      <Text style={styles.screenTitle}>TALENT POOL</Text>
      <View style={styles.search}>
        <Text style={styles.placeholder}>Search by role, skills, location…</Text>
      </View>
      <View style={styles.chipRow}>
        <Chip label="All" active />
        <Chip label="Camera" />
        <Chip label="Direction" />
        <Chip label="Post" />
      </View>
      {rows.map((r) => (
        <View key={r.name} style={styles.talentCard}>
          <Image source={{ uri: r.avatar }} style={styles.avatarSm} />
          <View style={styles.talentMain}>
            <Text style={styles.cardTitle}>{r.name}</Text>
            <Text style={styles.cardMeta}>{r.meta}</Text>
            <Text style={styles.amountSm}>{r.rate}</Text>
            <View style={styles.chipRow}>
              {r.skills.map((s) => (
                <Chip key={s} label={s} />
              ))}
            </View>
          </View>
          <View style={styles.availDotRow}>
            <View style={[styles.dot, r.tone === 'green' ? styles.dotGreen : styles.dotYellow]} />
            <Text style={styles.availLabel}>{r.status}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  )
}

function JobsScreen() {
  const jobs = [
    { co: 'Nike', letter: 'N', title: 'DOP – Brand Campaign', loc: 'Berlin', pay: '€4,200', status: 'Open', tone: 'green' as const },
    {
      co: 'Spotify',
      letter: 'S',
      title: 'Director – Artist Documentary',
      loc: 'Remote',
      pay: '€1,400/day',
      status: 'Open',
      tone: 'green' as const,
    },
    {
      co: 'MLB Europe',
      letter: 'M',
      title: 'Producer – London Series Content',
      loc: 'London',
      pay: '€1,800/day',
      status: 'Expiring soon',
      tone: 'yellow' as const,
    },
  ]
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
      <Text style={styles.screenTitle}>JOBS</Text>
      {jobs.map((j) => (
        <View key={j.co} style={styles.card}>
          <View style={styles.cardTop}>
            <LogoMark letter={j.letter} />
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>{j.co}</Text>
              <Text style={styles.cardMeta}>{j.title}</Text>
              <Text style={styles.cardMeta}>{j.loc} · {j.pay}</Text>
            </View>
          </View>
          <StatusPill label={j.status} tone={j.tone} />
        </View>
      ))}
    </ScrollView>
  )
}

function MessagesScreen() {
  return (
    <View style={styles.flex}>
      <View style={styles.backRow}>
        <ChevronLeft size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.backYellow}>Back</Text>
        <Text style={styles.projectTitle}>Brand Film</Text>
      </View>
      <ProjectTabs active="Messages" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.msgPad} showsVerticalScrollIndicator={false}>
        <View style={styles.msgMine}>
          <View style={styles.msgBubbleMine}>
            <Text style={styles.msgKicker}>CREA · you</Text>
            <Text style={styles.msgBodyMine}>
              Hey Jana, glad you joined the crew! 👋 Have you had a chance to review the brief? Would love your take on
              the camera approach before we lock the shotlist.
            </Text>
          </View>
          <View style={styles.msgAvatarMine}>
            <Text style={styles.msgAvatarLetter}>C</Text>
          </View>
        </View>
        <View style={styles.msgTheirs}>
          <Image source={{ uri: AVATAR_JANA }} style={styles.msgAvatar} />
          <View style={styles.msgBubbleTheirs}>
            <Text style={styles.msgKickerTheirs}>Jana Maier</Text>
            <Text style={styles.msgBodyTheirs}>
              Hey! Yes read it — love the concept. I think we should go handheld for the lifestyle scenes and locked-off
              for the product. Can chat tomorrow if that works?
            </Text>
          </View>
        </View>
      </ScrollView>
      <View style={styles.composer}>
        <Text style={styles.placeholder}>Message the crew…</Text>
        <View style={styles.sendBtn}>
          <Text style={styles.sendBtnText}>➤</Text>
        </View>
      </View>
    </View>
  )
}

function BookingScreen() {
  return (
    <View style={styles.flex}>
      <View style={styles.dimBackdrop} />
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Image source={{ uri: AVATAR_JANA }} style={styles.avatarSm} />
          <View style={styles.modalHeaderText}>
            <Text style={styles.modalTitle}>BOOK JANA MAIER</Text>
            <Text style={styles.cardMeta}>DOP · Munich</Text>
          </View>
          <X size={20} color="rgba(255,255,255,0.5)" strokeWidth={ICON_STROKE} />
        </View>
        <View style={styles.dateRange}>
          <View>
            <Text style={styles.dateLabel}>FROM</Text>
            <Text style={styles.dateValue}>18 Jun 2026</Text>
          </View>
          <Text style={styles.dateArrow}>→</Text>
          <View>
            <Text style={styles.dateLabel}>TO</Text>
            <Text style={styles.dateValue}>20 Jun 2026</Text>
          </View>
        </View>
        <Text style={styles.cardMeta}>3 days · €950/day</Text>
        <Text style={styles.amount}>~€2,850</Text>
        <Text style={[styles.sectionLabel, { marginTop: 16 }]}>PROJECT</Text>
        <View style={styles.selectField}>
          <Text style={styles.selectValue}>Apex Studio – Fashion Editorial</Text>
        </View>
        <Text style={[styles.sectionLabel, { marginTop: 12 }]}>MESSAGE</Text>
        <View style={styles.textArea}>
          <Text style={styles.placeholder}>Hi Jana! We'd love to book you for…</Text>
        </View>
        <View style={styles.modalActions}>
          <View style={styles.outlineBtn}>
            <Text style={styles.outlineBtnText}>Cancel</Text>
          </View>
          <View style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Send Booking Request</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

export function AppStoreScreenshotContent({ screen }: { screen: AppStoreScreenshotId }) {
  switch (screen) {
    case 'profile':
      return <ProfileScreen />
    case 'invoices':
      return <InvoicesScreen />
    case 'post-project':
      return <PostProjectScreen />
    case 'project-overview':
      return <ProjectOverviewScreen />
    case 'production':
      return <ProductionScreen />
    case 'availability':
      return <AvailabilityScreen />
    case 'talent-pool':
      return <TalentPoolScreen />
    case 'jobs':
      return <JobsScreen />
    case 'messages':
      return <MessagesScreen />
    case 'booking':
      return <BookingScreen />
    default:
      return null
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flex: 1 },
  scrollPad: { paddingHorizontal: 20, paddingBottom: 16 },
  msgPad: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: 'rgba(255,255,255,0.45)',
    marginTop: 16,
    marginBottom: 8,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 1,
    marginBottom: 14,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  profileHeader: { alignItems: 'center', paddingTop: 8 },
  avatarLg: { width: 88, height: 88, borderRadius: 44, marginBottom: 12 },
  avatarSm: { width: 44, height: 44, borderRadius: 22 },
  name: { fontSize: 22, fontWeight: '700', color: '#fff' },
  subtle: { fontSize: 14, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  socialRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  socialBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rolePill: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FFDC00',
  },
  rolePillText: { color: '#FFDC00', fontSize: 12, fontWeight: '700' },
  dayRate: { fontSize: 32, fontWeight: '800', color: '#FFDC00', marginTop: 14 },
  dayRateSub: { fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: 1, marginTop: 2 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  shareText: { color: '#FFDC00', fontSize: 13, fontWeight: '600' },
  bodyCopy: { fontSize: 14, lineHeight: 21, color: 'rgba(255,255,255,0.78)' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#141414',
  },
  chipActive: { borderColor: '#FFDC00', backgroundColor: 'rgba(255,220,0,0.08)' },
  chipText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#FFDC00' },
  chipAdd: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipAddText: { color: '#0a0a0a', fontSize: 20, fontWeight: '700' },
  primaryBtnSm: {
    backgroundColor: '#FFDC00',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  primaryBtnSmText: { color: '#0a0a0a', fontWeight: '800', fontSize: 13 },
  card: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardMain: { flex: 1 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardMeta: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  cardDetail: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 6 },
  amount: { color: '#FFDC00', fontSize: 18, fontWeight: '800' },
  amountSm: { color: '#FFDC00', fontSize: 14, fontWeight: '800', marginVertical: 4 },
  logoMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: { color: '#fff', fontWeight: '800', fontSize: 16 },
  statusPill: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillGreen: { backgroundColor: 'rgba(52,199,89,0.15)' },
  pillYellow: { backgroundColor: 'rgba(255,220,0,0.12)' },
  pillRed: { backgroundColor: 'rgba(255,59,48,0.15)' },
  statusPillText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  backYellow: { color: '#FFDC00', fontSize: 16, fontWeight: '600' },
  projectTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginLeft: 8, flex: 1 },
  dateRow: { flexDirection: 'row', gap: 10 },
  dateField: {
    flex: 1,
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  dateLabel: { fontSize: 10, color: 'rgba(255,255,255,0.45)', fontWeight: '700', letterSpacing: 1 },
  datePlaceholder: { marginTop: 6, color: 'rgba(255,255,255,0.28)', fontSize: 14 },
  textArea: {
    minHeight: 88,
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  placeholder: { color: 'rgba(255,255,255,0.28)', fontSize: 14 },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: '#FFDC00',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 15 },
  tabScroll: { marginBottom: 12, maxHeight: 36 },
  tabRow: { flexDirection: 'row', gap: 8, paddingRight: 20 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#141414',
  },
  tabActive: { backgroundColor: 'rgba(255,220,0,0.12)', borderWidth: 1, borderColor: '#FFDC00' },
  tabText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: '#FFDC00' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  statCard: {
    width: '47%',
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  statValue: { color: '#FFDC00', fontSize: 18, fontWeight: '800' },
  statLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 4 },
  blockTitle: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 0.8, marginTop: 8, marginBottom: 8 },
  banner: {
    backgroundColor: '#FFDC00',
    borderRadius: 12,
    padding: 12,
    marginVertical: 10,
  },
  bannerText: { color: '#0a0a0a', fontWeight: '700', fontSize: 13 },
  aboutBox: {
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  listCardText: { flex: 1, paddingRight: 8 },
  listCardTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  listCardSub: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 4, lineHeight: 17 },
  portfolioRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  portfolioCard: { flex: 1, backgroundColor: '#141414', borderRadius: 14, overflow: 'hidden' },
  portfolioImg: { width: '100%', height: 88 },
  portfolioTitle: { color: '#fff', fontSize: 12, fontWeight: '700', padding: 8, paddingBottom: 2 },
  portfolioSub: { color: 'rgba(255,255,255,0.45)', fontSize: 11, paddingHorizontal: 8, paddingBottom: 8 },
  availHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  availFree: { color: '#FFDC00', fontSize: 12, fontWeight: '700' },
  monthTitle: { color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700', marginVertical: 8 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  calDay: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#141414',
  },
  calDayAvail: { backgroundColor: 'rgba(52,199,89,0.2)' },
  calDayText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600' },
  calDayTextAvail: { color: '#34C759' },
  legend: { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 10 },
  linkYellow: { color: '#FFDC00', fontSize: 13, fontWeight: '600', marginTop: 12 },
  search: {
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  talentCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  talentMain: { flex: 1 },
  availDotRow: { alignItems: 'flex-end', justifyContent: 'flex-end' },
  dot: { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  dotGreen: { backgroundColor: '#34C759' },
  dotYellow: { backgroundColor: '#FFDC00' },
  availLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '600' },
  msgMine: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 14 },
  msgTheirs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  msgBubbleMine: {
    maxWidth: '78%',
    backgroundColor: '#FFDC00',
    borderRadius: 16,
    padding: 12,
    borderTopRightRadius: 4,
  },
  msgBubbleTheirs: {
    maxWidth: '78%',
    backgroundColor: '#1c1c1c',
    borderRadius: 16,
    padding: 12,
    borderTopLeftRadius: 4,
  },
  msgKicker: { fontSize: 10, fontWeight: '700', marginBottom: 4, color: 'rgba(0,0,0,0.45)' },
  msgKickerTheirs: { fontSize: 10, fontWeight: '700', marginBottom: 4, color: 'rgba(255,255,255,0.45)' },
  msgBodyMine: { color: '#0a0a0a', fontSize: 14, lineHeight: 20 },
  msgBodyTheirs: { color: 'rgba(255,255,255,0.85)', fontSize: 14, lineHeight: 20 },
  msgAvatarMine: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgAvatarLetter: { color: '#0a0a0a', fontWeight: '800' },
  msgAvatar: { width: 32, height: 32, borderRadius: 16 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#111',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { color: '#0a0a0a', fontWeight: '800' },
  dimBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  modal: {
    marginTop: 48,
    marginHorizontal: 16,
    backgroundColor: '#161616',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalHeaderText: { flex: 1 },
  modalTitle: { color: '#FFDC00', fontSize: 16, fontWeight: '800' },
  dateRange: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16 },
  dateValue: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 4 },
  dateArrow: { color: '#FFDC00', fontSize: 18, fontWeight: '800' },
  selectField: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  selectValue: { color: '#fff', fontSize: 14 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  outlineBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  outlineBtnText: { color: '#fff', fontWeight: '700' },
})
