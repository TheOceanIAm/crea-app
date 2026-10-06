import * as FileSystem from 'expo-file-system'
import * as Print from 'expo-print'
import {
  CALL_SHEET_PLACE_ORDER,
  DEFAULT_CALL_SHEET_SAFETY,
  callSheetDayLabel,
  formatCallSheetDate,
  parseCallSheet,
  personCallTime,
  personIsCast,
  personLocation,
  type CallSheetDocument,
} from '@/lib/callSheet'

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

function escapeMultiline(s: string) {
  return escapeCallSheetHtml(s).replace(/\n/g, '<br/>')
}

function cell(value: string | null | undefined, fallback = '—') {
  const t = (value ?? '').trim()
  return escapeCallSheetHtml(t || fallback)
}

export function buildCallSheetHtml(opts: {
  projectTitle: string
  shootDay: string
  notes?: string | null
  wrapTime?: string | null
  locationFallback?: string | null
  crew: CallSheetPdfCrew[]
  callSheet: CallSheetDocument | Record<string, CallSheetPdfOverride> | unknown
  dayNumber?: number | null
  dayCount?: number | null
  advanceLabel?: string | null
}): string {
  const doc = parseCallSheet(opts.callSheet)
  const dayLabel = callSheetDayLabel(opts.dayNumber ?? null, opts.dayCount ?? null)
  const general = doc.day.general_call.trim()
  const wrap = (opts.wrapTime ?? '').trim()

  const rowsHtml = opts.crew
    .map((m) => {
      const name = escapeCallSheetHtml(m.name || 'Member')
      const role = escapeCallSheetHtml(m.roleLabel)
      const ov = doc.people[m.key]
      const call = cell(personCallTime(ov, general))
      const loc = cell(
        personLocation(ov, [doc.places.basecamp, opts.locationFallback])
      )
      return `<tr><td>${name}</td><td>${role}</td><td>${call}</td><td>${loc}</td></tr>`
    })
    .join('')

  const chips = [
    ['Breakfast', doc.day.breakfast],
    ['Shoot call', doc.day.shoot_call],
    ['Lunch', doc.day.lunch],
    ['Wrap', wrap],
  ]
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `<span class="chip"><b>${escapeCallSheetHtml(k)}</b> ${escapeCallSheetHtml(v)}</span>`)
    .join('')

  const placesHtml = CALL_SHEET_PLACE_ORDER.map((place) => {
    const val = doc.places[place.key].trim()
    return `<div class="place"><div class="place-k">${escapeCallSheetHtml(place.label)}</div><div>${cell(val, place.key === 'hospital' ? 'TBD' : '—')}</div></div>`
  }).join('')

  const safetyNote = doc.day.safety_note.trim() || DEFAULT_CALL_SHEET_SAFETY
  const safetyMeeting = doc.day.safety_meeting.trim()
  const special = doc.special.trim()
  const deptBits = [
    ['Camera', doc.departments.camera],
    ['Sound', doc.departments.sound],
    ['Wardrobe', doc.departments.wardrobe],
  ].filter(([, v]) => v.trim())
  const contacts = [
    ['UPM', doc.contacts.upm],
    ['1st AD', doc.contacts.first_ad],
    ['2nd AD', doc.contacts.second_ad],
  ].filter(([, v]) => v.trim())

  const notesBlock = opts.notes?.trim()
    ? `<h2>Notes</h2><div class="notes">${escapeMultiline(opts.notes.trim())}</div>`
    : ''

  const medic = [doc.contacts.medic_name, doc.contacts.medic_phone].map((v) => v.trim()).filter(Boolean)
  const medicHtml = medic.length
    ? `<div class="place"><div class="place-k">Set medic</div><div>${escapeCallSheetHtml(medic.join(' · '))}</div></div>`
    : ''

  const sceneRows = doc.scenes
    .map((row) => {
      const move = row.move.trim() ? `<tr><td colspan="5"><b>Move</b> ${escapeCallSheetHtml(row.move)}</td></tr>` : ''
      return `<tr><td>${cell(row.scene)}</td><td>${cell(row.int_ext)}</td><td>${cell(row.description)}</td><td>${cell(row.cast)}</td><td>${cell(row.location)}</td></tr>${move}`
    })
    .join('')
  const scenesHtml = sceneRows
    ? `<h2>Today's scenes</h2><table><thead><tr><th>Scene</th><th>INT/EXT</th><th>Description</th><th>Cast</th><th>Location</th></tr></thead><tbody>${sceneRows}</tbody></table>`
    : ''

  const castRows = opts.crew
    .filter((m) => personIsCast(doc.people[m.key]))
    .map((m) => {
      const person = doc.people[m.key] ?? {}
      return `<tr><td>${cell(person.cast_no ? String(person.cast_no) : '')}</td><td>${escapeCallSheetHtml(m.name)}</td><td>${cell(person.character)}</td><td>${cell(person.status)}</td><td>${cell(personCallTime(person, general))}</td><td>${cell(person.hmu)}</td><td>${cell(person.wardrobe)}</td><td>${cell(person.ready)}</td><td>${cell(person.location)}</td><td>${cell(person.remarks || person.report)}</td></tr>`
    })
    .join('')
  const castHtml = castRows
    ? `<h2>Cast calls</h2><table><thead><tr><th>#</th><th>Name</th><th>Character</th><th>Status</th><th>Call</th><th>HMU</th><th>Wardrobe</th><th>Ready</th><th>Set</th><th>Note</th></tr></thead><tbody>${castRows}</tbody></table>`
    : ''

  const bgRows = doc.background
    .map(
      (row) =>
        `<tr><td>${escapeCallSheetHtml(row.label)}</td><td>${cell(row.count ? String(row.count) : '')}</td><td>${cell(row.in)}</td><td>${cell(row.ready)}</td></tr>`
    )
    .join('')
  const bgHtml = bgRows
    ? `<h2>Extras & stand-ins</h2><table><thead><tr><th>Who</th><th>Qty</th><th>Arrive</th><th>Ready</th></tr></thead><tbody>${bgRows}</tbody></table>`
    : ''

  const advanceHtml = opts.advanceLabel?.trim()
    ? `<h2>Next shoot day</h2><div class="notes">${escapeCallSheetHtml(opts.advanceLabel.trim())}</div>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color:#111; padding:24px; }
        h1 { font-size:22px; margin:0 0 4px; }
        h2 { font-size:13px; letter-spacing:0.12em; text-transform:uppercase; margin:22px 0 8px; color:#333; }
        .sub { color:#555; margin-bottom:6px; font-size:13px; }
        .call { font-size:28px; font-weight:800; margin:8px 0 12px; }
        .chips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
        .chip { border:1px solid #ddd; border-radius:8px; padding:6px 10px; font-size:12px; background:#fafafa; }
        .places { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; }
        .place { width:31%; min-width:140px; border:1px solid #ddd; border-radius:8px; padding:8px 10px; font-size:12px; }
        .place-k { font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#666; margin-bottom:4px; font-weight:700; }
        .safety { border:1px solid #111; padding:10px 12px; font-size:12px; margin:12px 0; }
        table { width:100%; border-collapse:collapse; font-size:13px; }
        th, td { border:1px solid #ccc; padding:8px 10px; text-align:left; }
        th { background:#f4f4f4; }
        .notes { white-space:pre-wrap; font-size:12px; line-height:1.45; border:1px solid #ddd; padding:12px; border-radius:8px; background:#fafafa; }
        .foot { display:flex; gap:16px; flex-wrap:wrap; font-size:12px; margin-top:18px; }
      </style></head><body>
        <h1>${escapeCallSheetHtml(opts.projectTitle)}</h1>
        <div class="sub">Call sheet · ${escapeCallSheetHtml(formatCallSheetDate(opts.shootDay))}${dayLabel ? ` · ${escapeCallSheetHtml(dayLabel)}` : ''}</div>
        <div class="call">${cell(general, 'General call TBD')}</div>
        ${chips ? `<div class="chips">${chips}</div>` : ''}
        <div class="safety"><b>Safety first.</b> ${escapeCallSheetHtml(safetyNote)}${safetyMeeting ? `<br/>Meeting: ${escapeCallSheetHtml(safetyMeeting)}` : ''}</div>
        <h2>Locations</h2>
        <div class="places">${placesHtml}${medicHtml}</div>
        ${scenesHtml}
        ${castHtml}
        ${bgHtml}
        ${special ? `<h2>Special instructions</h2><div class="notes">${escapeMultiline(special)}</div>` : ''}
        ${deptBits.length ? `<h2>Department notes</h2><div class="notes">${deptBits.map(([k, v]) => `<b>${escapeCallSheetHtml(k)}:</b> ${escapeMultiline(v)}`).join('<br/>')}</div>` : ''}
        <h2>Crew calls</h2>
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Call</th><th>Location</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${notesBlock}
        ${advanceHtml}
        ${contacts.length ? `<div class="foot">${contacts.map(([k, v]) => `<span><b>${escapeCallSheetHtml(k)}</b> ${escapeCallSheetHtml(v)}</span>`).join('')}</div>` : ''}
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
