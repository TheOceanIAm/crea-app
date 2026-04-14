import { View, Text, StyleSheet, Image, TouchableOpacity, Linking } from 'react-native'
import { MapPin, Landmark } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import type { PublicProfileWidgets } from '@/lib/publicProfileWidgets'

type Props = {
  name: string
  headline: string
  location: string
  bio: string
  avatarUrl: string
  widgets: PublicProfileWidgets
}

export function CeoPublicProfileView({ name, headline, location, bio, avatarUrl, widgets }: Props) {
  const displayName = name.trim() || 'Crea'
  const uri = avatarUrl.trim()
  const showImage = /^https?:\/\//i.test(uri)
  const letter = displayName.charAt(0).toUpperCase() || '?'

  const sports = widgets.sports
  const gn = widgets.goodNews

  return (
    <View style={styles.wrap}>
      <View style={styles.avatarWrap}>
        {showImage ? (
          <Image source={{ uri }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPh}>
            <Text style={styles.avatarLetter}>{letter}</Text>
          </View>
        )}
        <View style={styles.ceoBadge}>
          <Text style={styles.ceoBadgeText}>CEO</Text>
        </View>
      </View>

      <Text style={styles.name}>{displayName.toUpperCase()}</Text>
      {headline.trim() ? <Text style={styles.titleLine}>{headline.trim().toUpperCase()}</Text> : null}
      {location.trim() ? (
        <View style={styles.locRow}>
          <MapPin size={15} color="rgba(255,255,255,0.38)" strokeWidth={ICON_STROKE} />
          <Text style={styles.location}>{location.trim()}</Text>
        </View>
      ) : null}
      {bio.trim() ? <Text style={styles.bio}>{bio.trim()}</Text> : null}

      {sports ? (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.sportsEmoji}>⚾</Text>
            <View style={styles.cardHeadMid}>
              <Text style={styles.teamName}>{sports.team}</Text>
              <Text style={styles.seasonRow}>
                <Text style={styles.seasonYear}>{sports.seasonYear ?? ''}: </Text>
                <Text style={styles.seasonWins}>{sports.recordWins ?? ''}</Text>
                <Text style={styles.seasonDash}> – </Text>
                <Text style={styles.seasonLoss}>{sports.recordLosses ?? ''}</Text>
              </Text>
            </View>
            {sports.scheduleUrl ? (
              <TouchableOpacity onPress={() => Linking.openURL(sports.scheduleUrl!).catch(() => {})}>
                <Text style={styles.scheduleLink}>{sports.scheduleLabel ?? 'SCHEDULE →'}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.scheduleLinkMuted}>{sports.scheduleLabel ?? 'SCHEDULE →'}</Text>
            )}
          </View>

          <View style={styles.gameBlock}>
            <Text style={styles.gameLabelMuted}>LAST GAME</Text>
            <View style={styles.gameRow}>
              <Text style={styles.gameDate}>{sports.lastGame.date}</Text>
              <Text style={styles.gameMatch}>{sports.lastGame.matchup}</Text>
              {sports.lastGame.score ? <Text style={styles.gameScore}>{sports.lastGame.score}</Text> : null}
              {sports.lastGame.result ? (
                <View style={styles.winBadge}>
                  <Text style={styles.winBadgeText}>{sports.lastGame.result}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.gameBlock}>
            <Text style={styles.gameLabelAccent}>NEXT GAME</Text>
            <View style={styles.gameRow}>
              <Text style={styles.gameDate}>{sports.nextGame.date}</Text>
              <Text style={styles.gameMatch}>{sports.nextGame.matchup}</Text>
              {sports.nextGame.time ? <Text style={styles.gameTime}>{sports.nextGame.time}</Text> : null}
            </View>
          </View>
        </View>
      ) : null}

      {gn ? (
        <View style={[styles.card, styles.goodNewsCard]}>
          <View style={styles.gnHead}>
            <Landmark size={20} color="#4ade80" strokeWidth={ICON_STROKE} />
            <Text style={styles.gnKicker}>{gn.kicker}</Text>
          </View>
          <Text style={styles.gnBody}>{gn.body}</Text>
          {gn.source ? <Text style={styles.gnSource}>{gn.source}</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', width: '100%' },
  avatarWrap: {
    position: 'relative',
    marginBottom: 18,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#FFDC00',
    backgroundColor: '#1a1a1a',
  },
  avatarPh: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#FFDC00',
    backgroundColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: 44, fontWeight: '900', color: '#FFDC00' },
  ceoBadge: {
    position: 'absolute',
    right: -4,
    bottom: 4,
    backgroundColor: '#FFDC00',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: '#000000',
  },
  ceoBadgeText: { fontSize: 10, fontWeight: '900', color: '#0a0a0a', letterSpacing: 0.5 },
  name: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 2,
    textAlign: 'center',
  },
  titleLine: {
    marginTop: 10,
    fontSize: 11,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  location: { fontSize: 13, color: 'rgba(255,255,255,0.38)' },
  bio: {
    marginTop: 16,
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    lineHeight: 21,
    paddingHorizontal: 8,
  },
  card: {
    width: '100%',
    marginTop: 22,
    backgroundColor: '#111111',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  goodNewsCard: { borderColor: 'rgba(74,222,128,0.2)' },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  sportsEmoji: { fontSize: 22, marginTop: 2 },
  cardHeadMid: { flex: 1 },
  teamName: { fontSize: 16, fontWeight: '800', color: '#ffffff' },
  seasonRow: { marginTop: 4, fontSize: 13 },
  seasonYear: { color: 'rgba(255,255,255,0.45)' },
  seasonWins: { color: '#FFDC00', fontWeight: '800' },
  seasonDash: { color: 'rgba(255,255,255,0.45)' },
  seasonLoss: { color: 'rgba(255,255,255,0.45)' },
  scheduleLink: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.35)' },
  scheduleLinkMuted: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.22)' },
  gameBlock: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  gameLabelMuted: { fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.32)', letterSpacing: 1, marginBottom: 8 },
  gameLabelAccent: { fontSize: 9, fontWeight: '800', color: '#FFDC00', letterSpacing: 1, marginBottom: 8 },
  gameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  gameDate: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: '600' },
  gameMatch: { fontSize: 13, color: '#ffffff', fontWeight: '700' },
  gameScore: { fontSize: 13, color: 'rgba(255,255,255,0.65)' },
  gameTime: { fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  winBadge: {
    backgroundColor: '#166534',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  winBadgeText: { fontSize: 11, fontWeight: '900', color: '#ffffff' },
  gnHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  gnKicker: { fontSize: 10, fontWeight: '800', color: '#4ade80', letterSpacing: 1 },
  gnBody: { fontSize: 14, color: 'rgba(255,255,255,0.88)', lineHeight: 21 },
  gnSource: { marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.35)' },
})
