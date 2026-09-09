/** Public copy for the freelancer / company split. Internal role keys stay `freelancer` | `company`. */

export type AccountRole = 'freelancer' | 'company'

export const ACCOUNT_ROLE_COPY = {
  prompt: 'On a production, I mostly…',
  promptHint: 'This is your side of the marketplace — not whether you have a company on paper.',
  getBooked: {
    label: 'Get booked',
    desc: 'Apply to jobs, get found, and send invoices. You can still run your own projects and put your company name on the PDF.',
  },
  hireCrew: {
    label: 'Hire crew',
    desc: 'Post roles, keep a talent pool, and pay crew invoices. You won’t appear as talent or apply to jobs.',
  },
  legalHint:
    'A GmbH, UG, or Ltd doesn’t mean Hire crew. Choose that only if you mainly staff productions here.',
  onboardingTitle: 'On a production, I mostly…',
  onboardingSub:
    'Pick one. Get booked if you take jobs. Hire crew if you staff productions. A company on paper is not the same as Hire crew.',
  nameLabelHireCrew: 'Production / company name',
  invoiceHireOnlyTitle: 'Hire crew accounts receive invoices',
  invoiceHireOnlyBody:
    'Get booked accounts send invoices. Hire crew accounts receive and pay them.',
} as const
