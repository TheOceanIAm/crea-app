/** List prices (EUR) — must match Stripe + crea-services/lib/company-plan-catalog-prices.ts */
export const FREELANCER_PLAN_PRICE_EUR = {
  proMonthly: 8.99,
  proYearly: 59.99,
} as const

export const COMPANY_PLAN_PRICE_EUR = {
  proMonthly: 89,
  proYearly: 649.99,
  seatAddonMonthly: 12.99,
} as const

function formatEurPrice(amount: number): string {
  return `€${amount.toFixed(2).replace(/\.00$/, '')}`
}

export function freelancerProPriceLineMonthly(): string {
  return `${formatEurPrice(FREELANCER_PLAN_PRICE_EUR.proMonthly)}/mo`
}

export function freelancerProPriceLineYearly(): string {
  return `${formatEurPrice(FREELANCER_PLAN_PRICE_EUR.proYearly)}/yr`
}

export function companyPlanPriceLinePerMonth(): string {
  return `${formatEurPrice(COMPANY_PLAN_PRICE_EUR.proMonthly)}/mo`
}

export function companyPlanPriceLinePerYear(): string {
  return `${formatEurPrice(COMPANY_PLAN_PRICE_EUR.proYearly)}/yr`
}

export function companySeatAddonPriceLine(): string {
  return `${formatEurPrice(COMPANY_PLAN_PRICE_EUR.seatAddonMonthly)}/mo per seat`
}
