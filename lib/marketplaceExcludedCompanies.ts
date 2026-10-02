/** Keep in sync with crea-services/lib/marketplace-excluded-companies.ts */
const MARKETPLACE_EXCLUDED_COMPANY_IDS = new Set([
  'b6dc97ee-80ab-4cd4-b4af-496def9888f9',
  '03a7b802-0f40-47cb-b094-a97769d3d234',
])

export function isMarketplaceExcludedCompanyId(companyId: string | null | undefined): boolean {
  if (!companyId) return false
  return MARKETPLACE_EXCLUDED_COMPANY_IDS.has(companyId.trim().toLowerCase())
}
