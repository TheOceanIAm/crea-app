import { PLATFORM_TRIAL_DAYS } from '@/lib/platformTrial'

/** Aligned with crea-services `lib/subscription-trial.ts` — 30-day Pro, then Free or subscribe to Pro. */
export const trialMarketingEn = {
  headline: `${PLATFORM_TRIAL_DAYS} days of Pro — then choose your plan`,
  subline: `Registration is free. Every account gets ${PLATFORM_TRIAL_DAYS} days with full Pro features. After that you move to the Free plan automatically unless you subscribe to Pro.`,
  short: `${PLATFORM_TRIAL_DAYS}-day Pro trial, then Free or subscribe to Pro`,
} as const
