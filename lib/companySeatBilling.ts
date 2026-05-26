import { getCreaWebBaseUrl, openCreaWebPath } from '@/lib/creaWeb'

/** Company Plan & Billing on web — seat add-ons are Stripe-only (not App Store). */
export const COMPANY_SEAT_WEB_SETTINGS_PATH = '/settings/company?tab=plan'

export function companySeatWebSettingsUrl(): string {
  const base = getCreaWebBaseUrl().trim().replace(/\/$/, '') || 'https://www.creaservices.de'
  return `${base}${COMPANY_SEAT_WEB_SETTINGS_PATH}`
}

export async function openCompanySeatManagementOnWeb(): Promise<boolean> {
  return openCreaWebPath(COMPANY_SEAT_WEB_SETTINGS_PATH)
}
