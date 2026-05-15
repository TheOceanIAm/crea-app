/**
 * Keep in sync with crea-services/lib/profile-completion.ts (cron + web settings).
 */

export type FreelancerProfileCompletionInput = {
  avatar_url?: string | null
  headline?: string | null
  location?: string | null
  bio?: string | null
  skills?: unknown
  day_rate_amount?: number | null
  portfolio_website?: string | null
  portfolio_projects?: unknown
}

export type CompanyProfileCompletionRow = {
  company_name?: string | null
  logo_url?: string | null
  website?: string | null
  industry?: string | null
  size?: string | null
  location?: string | null
  bio?: string | null
  instagram?: string | null
  linkedin?: string | null
  vimeo?: string | null
  behance?: string | null
  youtube?: string | null
  twitter_x?: string | null
  billing_address?: string | null
  billing_email?: string | null
  vat_id?: string | null
}

export type CompletionResult = {
  pct: number
}

function nonEmpty(s: string | null | undefined, minLen = 1): boolean {
  return typeof s === 'string' && s.trim().length >= minLen
}

function skillCount(skills: unknown): number {
  if (!Array.isArray(skills)) return 0
  return skills.filter((s) => typeof s === 'string' && s.trim().length > 0).length
}

export function freelancerHasPortfolio(projects: unknown, website: string | null | undefined): boolean {
  if (nonEmpty(website, 4)) return true
  if (projects == null) return false
  let arr: unknown = projects
  if (typeof projects === 'string') {
    try {
      arr = JSON.parse(projects) as unknown
    } catch {
      return false
    }
  }
  if (!Array.isArray(arr)) return false
  for (const p of arr) {
    if (typeof p === 'string' && /^https?:\/\//i.test(p.trim())) return true
    if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>
      const link = String(o.link ?? o.url ?? o.href ?? '').trim()
      if (/^https?:\/\//i.test(link)) return true
    }
  }
  return false
}

export function computeFreelancerProfileCompletion(p: FreelancerProfileCompletionInput): CompletionResult {
  let score = 0
  if (nonEmpty(p.avatar_url, 8)) score += 12
  if (nonEmpty(p.headline, 2)) score += 10
  if (nonEmpty(p.bio, 40)) score += 18
  if (nonEmpty(p.location, 2)) score += 10
  if (skillCount(p.skills) >= 1) score += 18
  const rate = p.day_rate_amount
  if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) score += 17
  if (freelancerHasPortfolio(p.portfolio_projects, p.portfolio_website)) score += 15
  return { pct: Math.min(100, Math.round(score)) }
}

function companyHasSocial(cp: CompanyProfileCompletionRow): boolean {
  const keys: (keyof CompanyProfileCompletionRow)[] = [
    'instagram',
    'linkedin',
    'vimeo',
    'behance',
    'youtube',
    'twitter_x',
  ]
  return keys.some((k) => nonEmpty(cp[k] as string | null | undefined, 2))
}

export function computeCompanyProfileCompletion(
  profileName: string | null | undefined,
  avatarUrl: string | null | undefined,
  cp: CompanyProfileCompletionRow | null | undefined
): CompletionResult {
  const row = cp ?? {}
  let score = 0
  const displayName = nonEmpty(profileName, 2) || nonEmpty(row.company_name, 2)
  if (displayName) score += 16
  if (nonEmpty(row.logo_url, 8) || nonEmpty(avatarUrl, 8)) score += 14
  if (nonEmpty(row.bio, 40)) score += 18
  if (nonEmpty(row.location, 2)) score += 10
  if (nonEmpty(row.industry, 1)) score += 12
  if (nonEmpty(row.website, 4)) score += 12
  if (nonEmpty(row.size, 1)) score += 10
  if (companyHasSocial(row)) score += 8
  return { pct: Math.min(100, Math.round(score)) }
}

export function freelancerCompletionFromWebSettings(params: {
  avatarUrl: string
  jobTitle: string
  location: string
  bio: string
  skills: unknown
  dayRateStr: string
  portfolioWebsite: string
  portfolioItems: { url: string }[]
}): CompletionResult {
  const dayRateNum = params.dayRateStr.trim()
    ? Number.parseFloat(params.dayRateStr.replace(',', '.'))
    : Number.NaN
  const urls = params.portfolioItems.map((i) => i.url.trim()).filter(Boolean)
  const portfolio_projects =
    urls.length > 0 ? urls.map((link) => ({ link })) : undefined
  return computeFreelancerProfileCompletion({
    avatar_url: params.avatarUrl,
    headline: params.jobTitle,
    location: params.location,
    bio: params.bio,
    skills: params.skills,
    day_rate_amount: Number.isFinite(dayRateNum) ? dayRateNum : null,
    portfolio_website: params.portfolioWebsite,
    portfolio_projects,
  })
}

export type FreelancerBillingReadinessInput = {
  invoice_address?: string | null
  bank_iban?: string | null
  bank_account_holder?: string | null
  paypal_email?: string | null
  bank_bic?: string | null
  tax_number?: string | null
  steuer_id?: string | null
  vat_id?: string | null
}

function paypalLooksValid(raw: string | null | undefined): boolean {
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s.length >= 5 && s.includes('@') && !s.startsWith('@')
}

export function computeFreelancerBillingReadiness(p: FreelancerBillingReadinessInput): CompletionResult {
  let score = 0
  if (nonEmpty(p.invoice_address, 12)) score += 34

  let payment = 0
  const ibanOk = nonEmpty(p.bank_iban, 12) && nonEmpty(p.bank_account_holder, 2)
  if (ibanOk) {
    payment = 41
    if (nonEmpty(p.bank_bic, 4)) payment += 5
  } else if (paypalLooksValid(p.paypal_email)) {
    payment = 46
  }
  score += payment

  const taxOk =
    nonEmpty(p.tax_number, 8) || nonEmpty(p.steuer_id, 8) || nonEmpty(p.vat_id, 6)
  if (taxOk) score += 20

  return { pct: Math.min(100, Math.round(score)) }
}

export function freelancerBillingCompletionFromWebSettings(params: {
  invoiceAddress: string
  bankIban: string
  bankAccountHolder: string
  paypalEmail: string
  bankBic: string
  steuerId: string
  vatId: string
}): CompletionResult {
  return computeFreelancerBillingReadiness({
    invoice_address: params.invoiceAddress,
    bank_iban: params.bankIban,
    bank_account_holder: params.bankAccountHolder,
    paypal_email: params.paypalEmail,
    bank_bic: params.bankBic,
    steuer_id: params.steuerId,
    vat_id: params.vatId,
  })
}

export type CompanyBillingReadinessInput = {
  billing_address?: string | null
  billing_email?: string | null
  account_email?: string | null
  vat_id?: string | null
}

export function computeCompanyBillingReadiness(p: CompanyBillingReadinessInput): CompletionResult {
  let score = 0
  if (nonEmpty(p.billing_address, 12)) score += 45

  const bill = typeof p.billing_email === 'string' ? p.billing_email.trim() : ''
  const acct = typeof p.account_email === 'string' ? p.account_email.trim() : ''
  const mail = bill.includes('@') ? bill : acct.includes('@') ? acct : ''
  if (nonEmpty(mail, 5)) score += 35

  if (nonEmpty(p.vat_id, 6)) score += 20

  return { pct: Math.min(100, Math.round(score)) }
}
