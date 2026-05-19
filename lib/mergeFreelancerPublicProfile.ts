import { resolveCanonicalFreelancerHeadline } from '@/lib/freelancerHeadlineSync'

export type ProfilesPublicSlice = {
  headline?: string | null
  bio?: string | null
  location?: string | null
  skills?: string[] | null
  equipment?: string[] | null
  day_rate_amount?: number | null
  half_day_rate_amount?: number | null
  open_to_remote?: boolean | null
  open_to_travel?: boolean | null
  portfolio_website?: string | null
  portfolio_instagram?: string | null
  portfolio_linkedin?: string | null
  portfolio_vimeo?: string | null
  portfolio_behance?: string | null
}

export type FreelancerProfilesPublicSlice = {
  job_title?: string | null
  bio?: string | null
  location?: string | null
  skills?: string[] | null
  essentials?: string[] | null
  day_rate?: number | null
  half_day_rate?: number | null
  open_to_remote?: boolean | null
  open_to_travel?: boolean | null
  website?: string | null
  instagram?: string | null
  linkedin?: string | null
  vimeo?: string | null
  behance?: string | null
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter(Boolean)
}

function pickString(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    const t = typeof v === 'string' ? v.trim() : ''
    if (t) return t
  }
  return null
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const t = raw.trim()
    if (!t) continue
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

function pickSkills(p: ProfilesPublicSlice | null, fp: FreelancerProfilesPublicSlice | null): string[] {
  const fromP = strArray(p?.skills)
  const fromFp = strArray(fp?.skills)
  return fromP.length > 0 ? fromP : fromFp
}

function pickEssentials(p: ProfilesPublicSlice | null, fp: FreelancerProfilesPublicSlice | null): string[] {
  const fromEquipment = strArray(p?.equipment)
  const fromFp = strArray(fp?.essentials)
  return dedupeStrings(fromEquipment.length > 0 ? fromEquipment : fromFp)
}

export function mergeFreelancerPublicProfile(
  p: ProfilesPublicSlice | null,
  fp: FreelancerProfilesPublicSlice | null
) {
  const jobTitle = resolveCanonicalFreelancerHeadline(p?.headline, fp?.job_title) || null
  const dayRate =
    fp?.day_rate != null && !Number.isNaN(Number(fp.day_rate))
      ? Number(fp.day_rate)
      : p?.day_rate_amount != null && !Number.isNaN(Number(p.day_rate_amount))
        ? Number(p.day_rate_amount)
        : null

  return {
    job_title: jobTitle,
    bio: pickString(p?.bio, fp?.bio),
    location: pickString(p?.location, fp?.location),
    skills: pickSkills(p, fp),
    essentials: pickEssentials(p, fp),
    day_rate: dayRate,
    open_to_remote: Boolean(p?.open_to_remote ?? fp?.open_to_remote),
    open_to_travel: Boolean(p?.open_to_travel ?? fp?.open_to_travel),
    website: pickString(p?.portfolio_website, fp?.website),
    instagram: pickString(p?.portfolio_instagram, fp?.instagram),
    linkedin: pickString(p?.portfolio_linkedin, fp?.linkedin),
    vimeo: pickString(p?.portfolio_vimeo, fp?.vimeo),
    behance: pickString(p?.portfolio_behance, fp?.behance),
  }
}
