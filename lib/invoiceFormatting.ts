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

export function money(amount: number | null, currency: string | null | undefined) {
  if (amount == null) return '—'
  const cur = (currency || 'EUR').toUpperCase()
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(amount)
  } catch {
    return `€${amount.toLocaleString('en-US')}`
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
