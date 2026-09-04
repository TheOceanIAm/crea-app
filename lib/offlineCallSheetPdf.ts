import * as FileSystem from 'expo-file-system'
import * as Print from 'expo-print'

export type CallSheetPdfCrew = {
  key: string
  name: string
  roleLabel: string
}

export type CallSheetPdfOverride = { call_time?: string; location?: string }

export function escapeCallSheetHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildCallSheetHtml(opts: {
  projectTitle: string
  shootDay: string
  notes?: string | null
  wrapTime?: string | null
  locationFallback?: string | null
  crew: CallSheetPdfCrew[]
  callSheet: Record<string, CallSheetPdfOverride>
}): string {
  const rowsHtml = opts.crew
    .map((m) => {
      const name = escapeCallSheetHtml(m.name || 'Member')
      const role = escapeCallSheetHtml(m.roleLabel)
      const ov = opts.callSheet[m.key]
      const call = escapeCallSheetHtml(ov?.call_time?.trim() || '—')
      const loc = escapeCallSheetHtml(ov?.location?.trim() || opts.locationFallback || '—')
      return `<tr><td>${name}</td><td>${role}</td><td>${call}</td><td>${loc}</td></tr>`
    })
    .join('')

  const wrap = opts.wrapTime?.trim()
  const wrapLine = wrap ? ` · Wrap ${escapeCallSheetHtml(wrap)}` : ''
  const notesBlock = opts.notes?.trim()
    ? `<h2 style="font-size:16px;margin-top:28px;margin-bottom:10px;">Schedule &amp; travel</h2>
        <pre style="white-space:pre-wrap;font-family:inherit;font-size:12px;line-height:1.45;color:#222;border:1px solid #ddd;padding:12px;border-radius:8px;background:#fafafa;">${escapeCallSheetHtml(opts.notes.trim())}</pre>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color:#111; padding:24px; }
        h1 { font-size:22px; margin-bottom:8px; }
        .sub { color:#555; margin-bottom:20px; font-size:13px; }
        table { width:100%; border-collapse:collapse; font-size:13px; }
        th, td { border:1px solid #ccc; padding:8px 10px; text-align:left; }
        th { background:#f4f4f4; }
      </style></head><body>
        <h1>Call Sheet</h1>
        <div class="sub">${escapeCallSheetHtml(opts.projectTitle)} · ${escapeCallSheetHtml(opts.shootDay)}${wrapLine}</div>
        ${notesBlock}
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Call</th><th>Location</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </body></html>`
}

export async function generateCallSheetPdfFile(html: string, destPath: string): Promise<boolean> {
  try {
    const { uri } = await Print.printToFileAsync({ html })
    if (!uri) return false
    await FileSystem.copyAsync({ from: uri, to: destPath })
    return true
  } catch {
    return false
  }
}
