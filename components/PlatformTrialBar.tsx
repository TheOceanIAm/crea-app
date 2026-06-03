import { useMemo } from 'react'
import { StyleSheet, Text, View, type ViewStyle } from 'react-native'
import {
  isWithinPlatformTrialPeriod,
  platformTrialDaysFreeLabel,
  platformTrialDaysLeft,
  platformTrialProgressPercent,
} from '@/lib/platformTrial'

type PlatformTrialBarProps = {
  trialEndsAt: string | null
  accountCreatedAt: string | null
  embedded?: boolean
  style?: ViewStyle
}

/** Compact trial indicator — progress bar + “N days free” (matches web TrialBanner). */
export function PlatformTrialBar({
  trialEndsAt,
  accountCreatedAt,
  embedded = false,
  style,
}: PlatformTrialBarProps) {
  const daysLeft = useMemo(
    () => platformTrialDaysLeft(trialEndsAt, accountCreatedAt),
    [trialEndsAt, accountCreatedAt]
  )
  const inTrial = isWithinPlatformTrialPeriod(trialEndsAt, accountCreatedAt)

  if (daysLeft === null) return null

  const progress = platformTrialProgressPercent(daysLeft)
  const label = platformTrialDaysFreeLabel(daysLeft)
  const active = inTrial && daysLeft > 0

  return (
    <View style={[styles.wrap, embedded && styles.wrapEmbedded, style]}>
      <View style={styles.row}>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${active ? progress : 100}%` },
              !active && styles.fillEnded,
            ]}
          />
        </View>
        <Text style={styles.label}>
          {active ? (
            <>
              <Text style={styles.labelStrong}>{daysLeft}</Text> days Pro left
            </>
          ) : (
            label
          )}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#0a0a0a',
    paddingVertical: 12,
    paddingHorizontal: 2,
  },
  wrapEmbedded: {
    borderBottomWidth: 0,
    backgroundColor: 'transparent',
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,220,0,0.6)',
  },
  fillEnded: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  label: {
    flexShrink: 0,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  labelStrong: {
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
})
