import { useCallback, useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { PlatformTrialBar } from '@/components/PlatformTrialBar'
import { platformTrialDaysLeft } from '@/lib/platformTrial'
import {
  isCeoProfile,
  isCompanyProfile,
  isFreelancerProfile,
} from '@/lib/profileRole'
import { clearBillingNotice, getBillingNotice } from '@/lib/billingNotice'

export function PlatformTrialBanners({
  role,
  trialEndsAt,
  accountCreatedAt,
  hasStripeCustomer,
}: {
  role: string | null
  trialEndsAt: string | null
  accountCreatedAt: string | null
  hasStripeCustomer: boolean
}) {
  const router = useRouter()
  const [billingNotice, setBillingNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const msg = await getBillingNotice()
      if (!cancelled) setBillingNotice(msg)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const dismissNotice = useCallback(async () => {
    await clearBillingNotice()
    setBillingNotice(null)
  }, [])

  const isCeo = isCeoProfile(role ?? undefined)
  const isBillableRole =
    isFreelancerProfile(role ?? undefined) || isCompanyProfile(role ?? undefined)

  const showTrialBar =
    isBillableRole && !hasStripeCustomer && platformTrialDaysLeft(trialEndsAt, accountCreatedAt) !== null

  const showCeoTrialHint = isCeo && !isBillableRole

  if (!billingNotice && !showTrialBar && !showCeoTrialHint) {
    return null
  }

  return (
    <View style={styles.stack}>
      {billingNotice ? (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>{billingNotice}</Text>
          <TouchableOpacity onPress={() => void dismissNotice()} hitSlop={8}>
            <Text style={styles.dismiss}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {showCeoTrialHint ? (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>
            Only freelancer and company accounts support trial plans.
          </Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/profile')} hitSlop={8}>
            <Text style={styles.dismiss}>Profile</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {showTrialBar ? (
        <PlatformTrialBar trialEndsAt={trialEndsAt} accountCreatedAt={accountCreatedAt} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 10, marginBottom: 14 },
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.3)',
    backgroundColor: 'rgba(255,220,0,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  warnText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.85)',
  },
  dismiss: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFDC00',
    flexShrink: 0,
  },
})
