export const JOB_LISTING_BUDGET_TYPES = [
  { id: 'negotiable', label: 'Negotiable' },
  { id: 'day_rate', label: 'Day rate' },
  { id: 'fixed', label: 'Fixed budget' },
] as const

export type JobListingBudgetType = (typeof JOB_LISTING_BUDGET_TYPES)[number]['id']

export function parseJobListingBudgetInput(opts: {
  budgetType: JobListingBudgetType
  budgetAmount: string
  budgetCurrency?: string
}):
  | { ok: true; budget_type: JobListingBudgetType; budget_amount: number | null; budget_currency: string }
  | { ok: false; error: string } {
  const budget_currency =
    (opts.budgetCurrency ?? 'EUR').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'EUR'

  if (opts.budgetType === 'negotiable') {
    return { ok: true, budget_type: 'negotiable', budget_amount: null, budget_currency }
  }

  const raw = opts.budgetAmount.replace(',', '.').trim()
  const n = parseFloat(raw)
  if (Number.isNaN(n) || n <= 0) {
    return { ok: false, error: 'Enter a positive number for the budget or day rate.' }
  }

  return {
    ok: true,
    budget_type: opts.budgetType,
    budget_amount: n,
    budget_currency,
  }
}
