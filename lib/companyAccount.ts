import { supabase } from '@/lib/supabase'

/** Owner UUID or an active seat on that company account. */
export async function userIsActiveOnCompanyAccount(userId: string | null, companyId: string | null): Promise<boolean> {
  if (!userId || !companyId) return false
  if (userId === companyId) return true
  const { data } = await supabase
    .from('company_members')
    .select('profile_id')
    .eq('company_id', companyId)
    .eq('profile_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  return Boolean(data)
}

/**
 * Company account UUID this user should write as (`jobs.company_id`).
 * Owner → self. Team write seat → the company they belong to.
 */
export async function resolveActingCompanyId(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const [{ data: profile }, { data: companyProfile }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', userId).maybeSingle(),
    supabase.from('company_profiles').select('id').eq('id', userId).maybeSingle(),
  ])
  const role = String(profile?.role ?? '').toLowerCase()
  if (role === 'company' || companyProfile?.id) return userId

  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id, role')
    .eq('profile_id', userId)
    .eq('status', 'active')
    .in('role', ['admin', 'manager'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const companyId = typeof membership?.company_id === 'string' ? membership.company_id.trim() : ''
  return companyId || null
}
