/** Keep avatar rules aligned with crea-services/lib/profile-avatar.ts */

export function normalizeProfileAvatarUrl(url: string | null | undefined): string | null {
  const u = (url ?? '').trim()
  if (!u || !/^https?:\/\//i.test(u)) return null
  if (/ui-avatars\.com/i.test(u)) return null
  return u
}

export async function loadProfileAvatarsByIds(
  supabase: { from: (table: string) => unknown },
  profileIds: string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(profileIds.filter(Boolean))]
  const map = new Map<string, string>()
  if (ids.length === 0) return map

  const sb = supabase as {
    from: (t: string) => {
      select: (c: string) => { in: (col: string, vals: string[]) => Promise<{ data: unknown[] | null }> }
    }
  }

  const [{ data: profs }, { data: cps }] = await Promise.all([
    sb.from('profiles').select('id, avatar_url').in('id', ids),
    sb.from('company_profiles').select('id, logo_url').in('id', ids),
  ])

  for (const p of profs ?? []) {
    const row = p as { id: string; avatar_url?: string | null }
    const url = normalizeProfileAvatarUrl(row.avatar_url)
    if (url) map.set(String(row.id), url)
  }
  for (const c of cps ?? []) {
    const row = c as { id: string; logo_url?: string | null }
    const id = String(row.id)
    if (map.has(id)) continue
    const url = normalizeProfileAvatarUrl(row.logo_url)
    if (url) map.set(id, url)
  }
  return map
}
