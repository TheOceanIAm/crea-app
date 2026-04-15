/** Shared formatting for invoice list + detail. */

export type InvoiceStatusVariant = 'pending' | 'paid' | 'overdue' | 'draft'

export function invoiceStatusLabel(status: string) {
  const s = status?.toLowerCase() ?? ''
  if (s === 'pending') return 'Pending'
  if (s === 'paid') return 'Paid'
  if (s === 'overdue') return 'Overdue'
  if (s === 'draft') return 'Draft'
  if (s === 'cancelled') return 'Cancelled'
  return status || '—'
}

/** @deprecated Use invoiceStatusLabel */
export const statusDE = invoiceStatusLabel

export function statusVariant(status: string): InvoiceStatusVariant {
  const s = status?.toLowerCase() ?? ''
  if (s === 'paid') return 'paid'
  if (s === 'overdue') return 'overdue'
  if (s === 'draft') return 'draft'
  return 'pending'
}

/** Coerce Supabase `numeric` / JSON values for display (often strings at runtime). */
export function toMoneyNumber(amount: unknown): number | null {
  if (amount == null) return null
  if (typeof amount === 'number') return Number.isFinite(amount) ? amount : null
  if (typeof amount === 'string') {
    const t = amount.trim().replace(',', '.')
    if (!t) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Formats with currency symbol when possible; always includes ISO code in the fallback path. */
export function money(amount: number | string | null | undefined, currency: string | null | undefined) {
  const n = toMoneyNumber(amount)
  if (n == null) return '—'
  const cur = (currency || 'EUR').toUpperCase()
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n)
  } catch {
    const parts = n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    return `${cur} ${parts}`
  }
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
