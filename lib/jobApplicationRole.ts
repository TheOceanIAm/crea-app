import { parseJobCategoryRoles } from '@/lib/jobCategoryRoles'

export function crewDisplayRole(
  appliedRole?: string | null,
  profileJobTitle?: string | null,
  fallback = 'Freelancer'
): string {
  const a = (appliedRole ?? '').trim()
  if (a) return a
  const t = (profileJobTitle ?? '').trim()
  return t || fallback
}

export function resolveAppliedRoleForSubmit(
  jobCategory: string | null | undefined,
  selectedRole: string | null | undefined
): { ok: true; role: string | null } | { ok: false; error: string } {
  const roles = parseJobCategoryRoles(jobCategory)
  const sel = String(selectedRole ?? '').trim()

  if (roles.length === 0) {
    return { ok: true, role: sel || null }
  }
  if (roles.length === 1) {
    return { ok: true, role: sel || roles[0]! }
  }
  if (!sel) {
    return { ok: false, error: 'applied_role_required' }
  }
  if (!roles.includes(sel)) {
    return { ok: false, error: 'invalid_applied_role' }
  }
  return { ok: true, role: sel }
}

export function appliedRoleRequiredForJob(jobCategory: string | null | undefined): boolean {
  return parseJobCategoryRoles(jobCategory).length > 1
}
