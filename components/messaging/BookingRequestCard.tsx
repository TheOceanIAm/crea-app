import { useCallback } from 'react'
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native'
import { TouchableOpacity } from 'react-native-gesture-handler'
import { CalendarRange, ExternalLink } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import type { Href } from 'expo-router'
import type { BookingDmPayloadV1, BookingReplyStatus } from '@/lib/bookingDm'
import { getBookingNavigationHref, navigateBookingContext } from '@/lib/bookingNavigation'
import { resolveBookingWorkspaceJobId } from '@/lib/bookingWorkspaceResolve'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'

function formatShortRange(start: string, end: string): string {
  if (start === end) return start
  return `${start} → ${end}`
}

function formatWeekdayShort(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

type Props = {
  payload: BookingDmPayloadV1
  mine: boolean
  replyStatus: BookingReplyStatus | null
  bookingSenderId: string
  onAccept?: () => void
  onDecline?: () => void
  onLongPress?: () => void
  replyBusy?: boolean
}

export function BookingRequestCard({
  payload,
  mine,
  replyStatus,
  bookingSenderId,
  onAccept,
  onDecline,
  onLongPress,
  replyBusy,
}: Props) {
  const router = useRouter()
  const days = payload.selectedIsoDates?.length ? payload.selectedIsoDates : [payload.isoStartDate]
  const rangeLabel = formatShortRange(payload.isoStartDate, payload.isoEndDate)
  const showActions = !mine && !replyStatus && onAccept && onDecline
  const navOpts = { replyStatus, mine }

  const openContext = useCallback(async () => {
    const u = payload.openDeepLink.trim()
    if (!u) {
      Alert.alert('Could not open', 'This booking link is missing project details.')
      return
    }

    if (navigateBookingContext(router, u, navOpts)) return

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      Alert.alert('Sign in required', 'Log in to open the project workspace.')
      return
    }

    const jobId = await resolveBookingWorkspaceJobId({
      openDeepLink: u,
      projectTitle: payload.title,
      userId: user.id,
      bookingSenderId,
      mine,
    })

    if (jobId) {
      const openWorkspace = replyStatus === 'accepted' || mine
      const href = (openWorkspace ? `/project/${jobId}` : `/jobs/${jobId}`) as Href
      router.push(href)
      return
    }

    Alert.alert(
      'Could not open project',
      'Open the project from My Projects or ask the client to resend the booking invite.'
    )
  }, [payload.openDeepLink, payload.title, navOpts, router, bookingSenderId, mine, replyStatus])

  return (
    <TouchableOpacity
      activeOpacity={1}
      onLongPress={onLongPress}
      delayLongPress={380}
      style={[styles.card, mine ? styles.cardMine : styles.cardTheirs]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.kicker}>Booking request</Text>
        <Text style={styles.title} numberOfLines={3}>
          {payload.title.trim() || 'Project'}
        </Text>
      </View>

      <View style={styles.rangeRow}>
        <CalendarRange size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.rangeText}>{rangeLabel}</Text>
        <Text style={styles.dayCount}>
          {days.length} day{days.length === 1 ? '' : 's'}
        </Text>
      </View>

      {days.length > 0 ? (
        <View style={styles.dateChips}>
          {days.map((iso) => (
            <View key={iso} style={styles.chip}>
              <Text style={styles.chipText}>{formatWeekdayShort(iso)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {payload.userMessage?.trim() ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>Message</Text>
          <Text style={styles.noteBody}>{payload.userMessage.trim()}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        onPress={() => void openContext()}
        activeOpacity={0.75}
        style={styles.linkBtn}
        accessibilityRole="link"
        accessibilityLabel="Open job or project workspace"
      >
        <ExternalLink size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.linkBtnText}>Open job / project</Text>
      </TouchableOpacity>

      {mine && !replyStatus ? (
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>Awaiting response</Text>
        </View>
      ) : null}

      {replyStatus ? (
        <View
          style={[
            styles.resolvedPill,
            replyStatus === 'accepted' ? styles.resolvedAccepted : styles.resolvedDeclined,
          ]}
        >
          <Text style={styles.resolvedText}>
            {replyStatus === 'accepted' ? 'Accepted' : 'Declined'}
            {mine ? ' by freelancer' : ''}
          </Text>
        </View>
      ) : null}

      {showActions ? (
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={onDecline}
            disabled={replyBusy}
            activeOpacity={0.85}
            style={[styles.declineBtn, replyBusy && styles.actionDisabled]}
          >
            {replyBusy ? (
              <ActivityIndicator color="rgba(255,255,255,0.6)" size="small" />
            ) : (
              <Text style={styles.declineBtnText}>Decline</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onAccept}
            disabled={replyBusy}
            activeOpacity={0.85}
            style={[styles.acceptBtn, replyBusy && styles.actionDisabled]}
          >
            {replyBusy ? (
              <ActivityIndicator color="#0a0a0a" size="small" />
            ) : (
              <Text style={styles.acceptBtnText}>Accept</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    maxWidth: '92%',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 10,
  },
  cardMine: {
    alignSelf: 'flex-end',
    backgroundColor: '#141414',
    borderColor: 'rgba(255,220,0,0.35)',
  },
  cardTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: '#121212',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  cardHeader: { gap: 4 },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: 'rgba(255,220,0,0.85)',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 22,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  rangeText: {
    flex: 1,
    minWidth: 120,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.72)',
  },
  dayCount: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.38)',
  },
  dateChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.65)',
  },
  noteBox: {
    borderRadius: 10,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  noteLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
  },
  noteBody: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.88)',
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
    minHeight: 44,
  },
  linkBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFDC00',
  },
  statusPill: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255,220,0,0.1)',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,220,0,0.85)',
  },
  resolvedPill: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  resolvedAccepted: { backgroundColor: 'rgba(21,128,61,0.25)' },
  resolvedDeclined: { backgroundColor: 'rgba(180,83,9,0.22)' },
  resolvedText: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.88)',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  declineBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  declineBtnText: { fontSize: 14, fontWeight: '800', color: 'rgba(255,255,255,0.85)' },
  acceptBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#FFDC00',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  acceptBtnText: { fontSize: 14, fontWeight: '800', color: '#0a0a0a' },
  actionDisabled: { opacity: 0.55 },
})
