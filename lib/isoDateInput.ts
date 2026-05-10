/** Validates `YYYY-MM-DD`; returns normalized string or null. */
export function parseIsoDateInput(raw: string): string | null {
  const t = raw.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const [y, mo, d] = t.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return t
}
