import { money, toMoneyNumber } from '@/lib/invoiceFormatting'

export function resolveListingBudgetFields(opts: {
  budget_type?: string | null
  budget_amount?: number | null
  budget_currency?: string | null
  plan_total_budget?: number | null
  plan_currency?: string | null
}): { budget_type: string; budget_amount: number | null; budget_currency: string } {
  const listingType = String(opts.budget_type ?? 'negotiable').toLowerCase()
  const listingAmt = toMoneyNumber(opts.budget_amount)
  const hasListing =
    listingAmt != null && listingAmt > 0 && listingType !== 'negotiable'
  if (hasListing) {
    return {
      budget_type: listingType,
      budget_amount: listingAmt,
      budget_currency: (opts.budget_currency || 'EUR').toUpperCase(),
    }
  }
  const planAmt = toMoneyNumber(opts.plan_total_budget)
  if (planAmt != null && planAmt > 0) {
    return {
      budget_type: 'fixed',
      budget_amount: planAmt,
      budget_currency: (opts.plan_currency || opts.budget_currency || 'EUR').toUpperCase(),
    }
  }
  return {
    budget_type: listingType,
    budget_amount: listingAmt,
    budget_currency: (opts.budget_currency || 'EUR').toUpperCase(),
  }
}

/** Job / project budget line for lists and detail — always includes currency via `money()`. */
export function formatBudgetDisplay(opts: {
  budget_type: string
  budget_amount: number | null | string
  budget_currency?: string | null
}): string {
  const c = (opts.budget_currency || 'EUR').toUpperCase()
  const t = (opts.budget_type || '').toLowerCase()
  if (t === 'negotiable') return 'Negotiable'
  const amt = toMoneyNumber(opts.budget_amount)
  if (t === 'day_rate') {
    if (amt == null || amt <= 0) return 'Rate TBD'
    return `${money(amt, c)}/day`
  }
  if (t === 'fixed') {
    if (amt == null || amt <= 0) return 'Budget TBD'
    return `${money(amt, c)} fixed`
  }
  if (amt != null && amt > 0) return money(amt, c)
  return '—'
}

/** Project workspace stat card: amount + type with currency. */
export function formatProjectBudgetLine(opts: {
  budget_amount: number | null | string | undefined
  budget_type: string | null
  budget_currency?: string | null
}): string {
  const amt = toMoneyNumber(opts.budget_amount)
  if (amt == null || amt <= 0) return '—'
  const cur = (opts.budget_currency || 'EUR').toUpperCase()
  const t = (opts.budget_type || 'fixed').toUpperCase()
  return `${money(amt, cur)} · ${t}`
}
