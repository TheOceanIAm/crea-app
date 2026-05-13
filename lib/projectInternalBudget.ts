import { memberBookedDatesFromRow } from '@/lib/memberBookedDates'

export type CrewSpendMemberRow = {
  profile_id?: string
  member_role: string
  booked_dates?: unknown
  scheduling_start_date?: string | null
  scheduling_end_date?: string | null
  profiles: {
    name?: string | null
    day_rate_amount?: number | null
    rates_currency?: string | null
  } | null
}

export type CrewSpendLine = {
  profileIdKey: string
  displayName: string
  days: number
  dayRate: number
  profileCurrency: string | null
  subtotal: number
  currencyMatchesPlan: boolean
}

function normCurrency(c: string | null | undefined): string {
  return (c ?? 'EUR').trim().toUpperCase() || 'EUR'
}

/** Registered crew/lead (not client row): shoot days × public profile day rate. */
export function computeCrewSpendLines(
  rows: CrewSpendMemberRow[],
  planCurrency: string,
): { lines: CrewSpendLine[]; total: number; currenciesMixed: boolean } {
  const pc = normCurrency(planCurrency)
  const lines: CrewSpendLine[] = []
  let currenciesMixed = false

  rows.forEach((row, idx) => {
    if ((row.member_role ?? '').toLowerCase() === 'company') return
    const dates = memberBookedDatesFromRow(row)
    const days = dates.length
    const rate = typeof row.profiles?.day_rate_amount === 'number' ? row.profiles.day_rate_amount : 0
    const profCur = row.profiles?.rates_currency != null ? normCurrency(row.profiles.rates_currency) : pc
    if (profCur !== pc) currenciesMixed = true
    const subtotal = Math.round(days * rate * 100) / 100
    if (days === 0 && rate === 0) return
    const name = (row.profiles?.name ?? '').trim() || 'Crew member'
    lines.push({
      profileIdKey: row.profile_id ?? `row-${idx}`,
      displayName: name,
      days,
      dayRate: rate,
      profileCurrency: row.profiles?.rates_currency ?? null,
      subtotal,
      currencyMatchesPlan: profCur === pc,
    })
  })

  const total = Math.round(lines.reduce((s, l) => s + l.subtotal, 0) * 100) / 100
  return { lines, total, currenciesMixed }
}

export function sumBudgetLineSpent(
  rows: { spent_amount?: number | null; planned_amount?: number | null }[],
): { spent: number; planned: number } {
  let spent = 0
  let planned = 0
  for (const r of rows) {
    const s = typeof r.spent_amount === 'number' && !Number.isNaN(r.spent_amount) ? r.spent_amount : 0
    const p = typeof r.planned_amount === 'number' && !Number.isNaN(r.planned_amount) ? r.planned_amount : 0
    spent += s
    planned += p
  }
  return {
    spent: Math.round(spent * 100) / 100,
    planned: Math.round(planned * 100) / 100,
  }
}

export function formatMoneyAmount(amount: number | null | undefined, currency = 'EUR'): string {
  const n = typeof amount === 'number' && !Number.isNaN(amount) ? amount : 0
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(n)
  } catch {
    return `${n.toFixed(0)} ${currency}`
  }
}
