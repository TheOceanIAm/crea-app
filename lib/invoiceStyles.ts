import { StyleSheet } from 'react-native'
import type { InvoiceStatusVariant } from '@/lib/invoiceFormatting'

/** Badge styles for invoice status (shared list + detail). */
export const invoiceBadgeStyles = StyleSheet.create({
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  statusPending: { color: '#FFDC00' },
  statusPaid: { color: '#6ee7a0' },
  statusOverdue: { color: '#ff8888' },
  statusDraft: { color: 'rgba(255,255,255,0.45)' },
  badgePending: { backgroundColor: 'rgba(255,220,0,0.12)' },
  badgePaid: { backgroundColor: 'rgba(80,200,120,0.15)' },
  badgeOverdue: { backgroundColor: 'rgba(255,80,80,0.12)' },
  badgeDraft: { backgroundColor: 'rgba(255,255,255,0.08)' },
})

export function statusBadgeFor(variant: InvoiceStatusVariant) {
  switch (variant) {
    case 'paid':
      return {
        wrap: invoiceBadgeStyles.badgePaid,
        text: invoiceBadgeStyles.statusPaid,
      }
    case 'overdue':
      return {
        wrap: invoiceBadgeStyles.badgeOverdue,
        text: invoiceBadgeStyles.statusOverdue,
      }
    case 'draft':
      return {
        wrap: invoiceBadgeStyles.badgeDraft,
        text: invoiceBadgeStyles.statusDraft,
      }
    default:
      return {
        wrap: invoiceBadgeStyles.badgePending,
        text: invoiceBadgeStyles.statusPending,
      }
  }
}
