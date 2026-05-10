import { Linking, Pressable, StyleSheet, Text, View, ActivityIndicator } from 'react-native'
import { CalendarRange, ExternalLink } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import type { BookingDmPayloadV1, BookingReplyStatus } from '@/lib/bookingDm'
import { navigateCreaDeepLink, parseCreaDeepLinkHref } from '@/lib/parseCreaDeepLinkHref'
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
  onAccept?: () => void
  onDecline?: () => void
  replyBusy?: boolean
}

export function BookingRequestCard({
  payload,
  mine,
  replyStatus,
  onAccept,
  onDecline,
  replyBusy,
}: Props) {
  const router = useRouter()
  const days = payload.selectedIsoDates?.length ? payload.selectedIsoDates : [payload.isoStartDate]
  const rangeLabel = formatShortRange(payload.isoStartDate, payload.isoEndDate)
  const showActions = !mine && !replyStatus && onAccept && onDecline

  const openContext = () => {
    const u = payload.openDeepLink.trim()
    if (!u) return
    if (navigateCreaDeepLink(router, u)) return
    const href = parseCreaDeepLinkHref(u)
    if (href) {
      router.push(href)
      return
    }
    void Linking.openURL(u)
  }

  return (
    <View style={[styles.card, mine ? styles.cardMine : styles.cardTheirs]}>
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

      <Pressable
        onPress={openContext}
        style={({ pressed }) => [styles.linkBtn, pressed && styles.linkBtnPressed]}
        hitSlop={8}
      >
        <ExternalLink size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.linkBtnText}>Open job / project</Text>
      </Pressable>

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
          <Pressable
            onPress={onDecline}
            disabled={replyBusy}
            style={({ pressed }) => [
              styles.declineBtn,
              (pressed || replyBusy) && styles.actionPressed,
              replyBusy && styles.actionDisabled,
            ]}
          >
            {replyBusy ? (
              <ActivityIndicator color="rgba(255,255,255,0.6)" size="small" />
            ) : (
              <Text style={styles.declineBtnText}>Decline</Text>
            )}
          </Pressable>
          <Pressable
            onPress={onAccept}
            disabled={replyBusy}
            style={({ pressed }) => [
              styles.acceptBtn,
              (pressed || replyBusy) && styles.actionPressed,
              replyBusy && styles.actionDisabled,
            ]}
          >
            {replyBusy ? (
              <ActivityIndicator color="#0a0a0a" size="small" />
            ) : (
              <Text style={styles.acceptBtnText}>Accept</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
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
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  linkBtnPressed: { opacity: 0.7 },
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
  actionPressed: { opacity: 0.88 },
  actionDisabled: { opacity: 0.55 },
})
