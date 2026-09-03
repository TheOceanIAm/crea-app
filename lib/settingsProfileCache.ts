import { getCache, setCache } from '@/lib/appCache'
import { readPersistedCache, writePersistedCache } from '@/lib/persistedCache'
import { LIST_DISK_TTL_MS, LIST_MEM_TTL_MS } from '@/lib/cachePolicy'
import type { NotificationSettings, PortfolioProject } from '@/lib/profileSettingsExtras'
import type { CompanyProfileCompletionRow } from '@/lib/profile-completion'

export type SettingsProfileCache = {
  email: string
  editName: string
  role: string
  headline: string
  location: string
  bio: string
  avatarUrl: string
  skillsList: string[]
  equipmentList: string[]
  portfolioWebsite: string
  portfolioInstagram: string
  portfolioLinkedin: string
  portfolioVimeo: string
  portfolioBehance: string
  portfolioProjects: PortfolioProject[]
  bankHolder: string
  bankIban: string
  bankBic: string
  paypalEmail: string
  invoiceAddress: string
  taxNumber: string
  vatRegistered: boolean
  notif: NotificationSettings
  subscriptionTier: 'free' | 'pro'
  trialEndsAt: string | null
  dayRate: string
  halfDayRate: string
  ratesCurrency: string
  ratesNotes: string
  companyCpExtras: CompanyProfileCompletionRow | null
}

const MEM_TTL_MS = LIST_MEM_TTL_MS
const DISK_TTL_MS = LIST_DISK_TTL_MS

export function settingsProfileCacheKey(userId: string): string {
  return `settings-profile:${userId}`
}

function settingsProfileDiskKey(userId: string): string {
  return `crea:settings-profile:${userId}`
}

export function readCachedSettingsProfile(userId: string): SettingsProfileCache | null {
  return getCache<SettingsProfileCache>(settingsProfileCacheKey(userId))
}

export function cacheSettingsProfile(userId: string, data: SettingsProfileCache): void {
  setCache(settingsProfileCacheKey(userId), data, MEM_TTL_MS)
}

export async function hydrateSettingsProfileFromDisk(userId: string): Promise<boolean> {
  const hit = await readPersistedCache<SettingsProfileCache>(settingsProfileDiskKey(userId))
  if (!hit) return false
  cacheSettingsProfile(userId, hit)
  return true
}

export async function persistSettingsProfileToDisk(
  userId: string,
  data: SettingsProfileCache
): Promise<void> {
  await writePersistedCache(settingsProfileDiskKey(userId), data, DISK_TTL_MS)
}

export async function prefetchSettingsProfileShell(userId: string): Promise<void> {
  if (readCachedSettingsProfile(userId)) return
  await hydrateSettingsProfileFromDisk(userId)
}
