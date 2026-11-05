export type BudgetLineSpendDraft = {
  id: string
  label: string
  plannedStr: string
  spentStr: string
  sort_order: number
}

export type BudgetReceiptRow = {
  id: string
  budget_line_id: string | null
  label: string
  amount: number
  currency: string
  vendor: string | null
  storage_path: string | null
  created_at: string
}

export const BUDGET_RECEIPT_BUCKET = 'budget-receipts'

export function parseReceiptAmount(raw: string): number | null {
  const t = raw.trim().replace(/\s+/g, '')
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100
}

/** Replace Actual on the matching category with the server total. Planned edits stay. */
export function applyServerSpent<T extends BudgetLineSpendDraft>(
  lines: T[],
  input: { lineId: string; label: string; spent: number },
): T[] {
  const spent = Math.round(input.spent * 100) / 100
  const spentStr = String(spent)
  const labelKey = input.label.trim().toLowerCase()
  const idx = lines.findIndex(
    (line) => line.id === input.lineId || line.label.trim().toLowerCase() === labelKey,
  )
  if (idx === -1) {
    const sort = lines.length ? Math.max(...lines.map((line) => line.sort_order)) + 1 : 0
    return [
      ...lines,
      {
        id: input.lineId,
        label: input.label,
        plannedStr: '',
        spentStr,
        sort_order: sort,
      } as T,
    ]
  }
  return lines.map((line, i) =>
    i === idx ? { ...line, id: input.lineId || line.id, label: line.label.trim() || input.label, spentStr } : line,
  )
}

export function receiptBlocksLine(receipts: BudgetReceiptRow[], line: { id: string; label: string }): boolean {
  const labelKey = line.label.trim().toLowerCase()
  return receipts.some(
    (receipt) =>
      (receipt.budget_line_id != null && receipt.budget_line_id === line.id) ||
      receipt.label.trim().toLowerCase() === labelKey,
  )
}
