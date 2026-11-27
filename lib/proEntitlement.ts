import { supabase } from '@/lib/supabase'
import { isStaffUnlimitedPro } from '@/lib/staffUnlimitedPro'

const PAID_BILLING = new Set(['active', 'trialing', 'past_due'])

export type ProAccessInput = {
  trialEndsAt?: string | null
  billingStatus?: string | null
  stripeSubId?: string | null
}

/** Same rule as crea-services `lib/pro-entitlement.ts`. */
export function proToolsUnlocked(input: ProAccessInput & { userId?: string | null }): boolean {
  if (isStaffUnlimitedPro(input.userId)) return true
  const status = String(input.billingStatus ?? '').trim().toLowerCase()
  if (PAID_BILLING.has(status)) return true
  if (status === 'canceled' || status === 'cancelled' || status === 'unpaid') {
    return complimentaryOpen(input.trialEndsAt)
  }
  if (String(input.stripeSubId ?? '').trim()) return true
  return complimentaryOpen(input.trialEndsAt)
}

function complimentaryOpen(trialEndsAt: string | null | undefined): boolean {
  const raw = typeof trialEndsAt === 'string' ? trialEndsAt.trim() : ''
  if (!raw) return false
  const end = new Date(raw).getTime()
  if (Number.isNaN(end)) return false
  return Date.now() < end
}

/** Pro tools from the profile row the user cannot forge once the billing guard is applied. */
export async function loadProToolsPlan(userId: string): Promise<'free' | 'pro'> {
  if (isStaffUnlimitedPro(userId)) return 'pro'
  const { data } = await supabase
    .from('profiles')
    .select('trial_ends_at, billing_status, stripe_sub_id')
    .eq('id', userId)
    .maybeSingle()
  return proToolsUnlocked({
    userId,
    trialEndsAt: data?.trial_ends_at,
    billingStatus: data?.billing_status,
    stripeSubId: data?.stripe_sub_id,
  })
    ? 'pro'
    : 'free'
}
