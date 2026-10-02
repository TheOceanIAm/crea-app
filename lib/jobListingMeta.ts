import { formatBudgetDisplay } from '@/lib/budgetFormatting'

/** First place name from a geocoded location string. */
export function shortJobPlace(location: string | null | undefined): string | null {
  const raw = (location ?? '').trim()
  if (!raw) return null
  const beforeComma = raw.split(',')[0]?.trim() || raw
  const beforeDash = beforeComma.split(' - ')[0]?.trim() || beforeComma
  return beforeDash || null
}

/** `2026-10-14` → `Oct 14th`. */
export function formatJobListingDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ymd = iso.slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  const monthLabel = date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  const mod100 = day % 100
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? 'th'
      : day % 10 === 1
        ? 'st'
        : day % 10 === 2
          ? 'nd'
          : day % 10 === 3
            ? 'rd'
            : 'th'
  return `${monthLabel} ${day}${suffix}`
}

/** `Brussels, on-site · Oct 14th · €5,000 fixed` */
export function formatJobListingMeta(opts: {
  location?: string | null
  locationType?: string | null
  startDate?: string | null
  budgetType?: string | null
  budgetAmount?: number | null
  budgetCurrency?: string | null
}): string {
  const place = shortJobPlace(opts.location)
  const whereType = (opts.locationType ?? '').trim().toLowerCase()
  const where = [place, whereType].filter(Boolean).join(', ')
  const date = formatJobListingDate(opts.startDate)
  const budget =
    opts.budgetType != null
      ? formatBudgetDisplay({
          budget_type: opts.budgetType,
          budget_amount: opts.budgetAmount ?? null,
          budget_currency: opts.budgetCurrency,
        })
      : ''
  const budgetLabel = budget && budget !== '—' ? budget.replace(/\.00(?=\s|\/|$)/, '') : ''
  return [where, date, budgetLabel].filter(Boolean).join(' · ')
}
