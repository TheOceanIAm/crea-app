import * as FileSystem from 'expo-file-system'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import {
  budgetStatusFilename,
  buildBudgetStatusDocument,
  type BudgetStatusBlock,
  type BudgetStatusExportInput,
} from '@/lib/budgetStatusExport'

export type { BudgetStatusProject } from '@/lib/budgetStatusExport'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function toneColor(tone: 'over' | 'under' | 'neutral') {
  if (tone === 'over') return { bg: '#fee2e2', fg: '#991b1b' }
  if (tone === 'under') return { bg: '#d1fae5', fg: '#065f46' }
  return { bg: '#f5f5f5', fg: '#141414' }
}

function renderBlock(block: BudgetStatusBlock) {
  const caption = block.caption ? `<p class="caption">${escapeHtml(block.caption)}</p>` : ''
  if (block.kind === 'rows') {
    const rows = block.rows
      .map(
        (row, index) =>
          `<tr class="${index === block.rows.length - 1 ? 'emph' : ''}"><td>${escapeHtml(row.label)}</td><td class="num">${escapeHtml(row.value)}</td></tr>`
      )
      .join('')
    return `<section><h2>${escapeHtml(block.title)}</h2>${caption}<table class="plain"><tbody>${rows}</tbody></table></section>`
  }
  const body =
    block.rows.length > 0
      ? block.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
          .join('')
      : `<tr><td colspan="${block.headers.length}">Nothing listed yet</td></tr>`
  const head = block.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')
  return `<section><h2>${escapeHtml(block.title)}</h2>${caption}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`
}

export function buildBudgetStatusHtml(input: BudgetStatusExportInput): string {
  const model = buildBudgetStatusDocument(input)
  const tone = toneColor(model.standTone)
  const facts = model.facts
    .map((fact) => `<div class="fact"><span>${escapeHtml(fact.label)}</span>${escapeHtml(fact.value)}</div>`)
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #141414; margin: 0; padding: 0 0 24px; }
    .band { background: #0a0a0a; color: #fff; padding: 22px 24px 18px; border-bottom: 4px solid #FFDC00; }
    .brand { color: #FFDC00; font-weight: 800; letter-spacing: 0.14em; font-size: 12px; margin: 0; }
    .kind { color: rgba(255,255,255,0.62); font-size: 11px; letter-spacing: 0.16em; margin: 6px 0 0; }
    h1 { font-size: 26px; line-height: 1.15; margin: 10px 0 0; }
    .body { padding: 18px 24px 8px; }
    .facts { margin: 0 0 14px; }
    .fact { display: flex; gap: 16px; font-size: 13px; padding: 3px 0; }
    .fact span { width: 108px; color: #666; font-weight: 700; flex: none; }
    .stand { background: ${tone.bg}; color: ${tone.fg}; border-radius: 10px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .stand b { font-size: 18px; }
    .stand .amt { font-size: 20px; font-weight: 800; }
    h2 { font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; margin: 22px 0 6px; }
    .caption { color: #666; font-size: 12px; margin: 0 0 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #e5e5e5; padding: 7px 8px; text-align: left; vertical-align: top; }
    th { background: #FFDC00; color: #0a0a0a; }
    td:last-child, th:last-child { text-align: right; font-weight: 700; }
    table.plain td { border: none; border-top: 1px solid #eee; }
    tr.emph td { font-weight: 800; font-size: 13px; }
    .foot { color: #888; font-size: 11px; margin-top: 22px; }
  </style></head><body>
    <div class="band">
      <p class="brand">CREA</p>
      <p class="kind">BUDGET STATUS</p>
      <h1>${escapeHtml(model.projectTitle)}</h1>
    </div>
    <div class="body">
      <div class="facts">${facts}</div>
      <div class="stand"><b>${escapeHtml(model.standPhrase)}</b><span class="amt">${escapeHtml(model.standAmount)}</span></div>
      ${model.blocks.map(renderBlock).join('')}
      <p class="foot">Internal budget snapshot. Freelancers do not see this.</p>
    </div>
  </body></html>`
}

export async function shareBudgetStatusPdf(input: BudgetStatusExportInput): Promise<void> {
  const html = buildBudgetStatusHtml(input)
  const { uri } = await Print.printToFileAsync({ html })
  if (!uri) throw new Error('Could not create the PDF.')
  const filename = budgetStatusFilename(input.project.title, input.exportedAt)
  const root = FileSystem.cacheDirectory ?? FileSystem.documentDirectory
  let shareUri = uri
  if (root) {
    const dest = `${root}${filename}`
    const existing = await FileSystem.getInfoAsync(dest)
    if (existing.exists) await FileSystem.deleteAsync(dest, { idempotent: true })
    await FileSystem.copyAsync({ from: uri, to: dest })
    shareUri = dest
  }
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.')
  }
  await Sharing.shareAsync(shareUri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Budget status',
    UTI: 'com.adobe.pdf',
  })
}
