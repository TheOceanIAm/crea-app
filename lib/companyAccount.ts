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
