/**
 * Hendrik's own test accounts. They stay on unlimited Pro and never see the
 * platform-trial bar. Keep in sync with crea-services/lib/staff-unlimited-pro.ts.
 */
const STAFF_UNLIMITED_PRO_IDS = new Set([
  /** Crea Services — internal test company */
  'b6dc97ee-80ab-4cd4-b4af-496def9888f9',
  /** Chris Noviak — internal test freelancer */
  'b008d171-8f73-415d-b585-3749e6a28efa',
])

export function isStaffUnlimitedPro(userId: string | null | undefined): boolean {
  if (!userId) return false
  return STAFF_UNLIMITED_PRO_IDS.has(userId.trim().toLowerCase())
}
