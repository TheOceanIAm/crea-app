import * as FileSystem from 'expo-file-system'
import * as Print from 'expo-print'
import {
  DEFAULT_CALL_SHEET_SAFETY,
  parseCallSheet,
  personCallTime,
  personIsCast,
  type CallSheetDocument,
} from '@/lib/callSheet'
import {
  buildStudioCallSheetHtml,
  type StudioCallSheet,
  type StudioCastRow,
  type StudioCrewRow,
  type StudioKeyContact,
  type StudioLocation,
  type StudioScheduleRow,
} from '@/lib/callSheetStudio'

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

/** Rough department from a free-text role, for grouping the crew list (same as web). */
export function departmentForRole(role: string): string {
  const r = role.toLowerCase()
  const has = (...words: string[]) => words.some((w) => r.includes(w))
  if (has('director', 'producer', 'production', ' ad', '1st ad', '2nd ad', 'assistant director', 'upm', 'pm', 'coordinator', 'runner', 'pa ', 'script')) return 'Production'
  if (has('dop', 'dp', 'cinematograph', 'camera', 'ac', 'focus', 'dit', 'steadicam', 'operator', 'video')) return 'Camera'
  if (has('gaffer', 'spark', 'light', 'electric', 'grip', 'best boy')) return 'Lighting & grip'
  if (has('sound', 'boom', 'audio', 'mixer')) return 'Sound'
  if (has('art', 'props', 'set dress', 'designer', 'construction')) return 'Art'
  if (has('hmu', 'make-up', 'makeup', 'hair', 'mua')) return 'HMU'
  if (has('wardrobe', 'stylist', 'costume')) return 'Wardrobe'
  if (has('photo', 'bts')) return 'Photo & BTS'
  if (has('catering', 'driver', 'location', 'security', 'medic')) return 'Locations & logistics'
  return 'Crew'
}

/** Studio call sheet (lib/callSheetStudio.ts), identical to the web export. */
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
  company?: { name: string; address?: string; logoUrl?: string | null } | null
}): string {
  const doc = parseCallSheet(opts.callSheet)
  const general = doc.day.general_call.trim()
  const wrap = (opts.wrapTime ?? '').trim()

  const keyContacts: StudioKeyContact[] = (
    [
      ['UPM', doc.contacts.upm],
      ['1st AD', doc.contacts.first_ad],
      ['2nd AD', doc.contacts.second_ad],
      ['Set medic', [doc.contacts.medic_name, doc.contacts.medic_phone].map((v) => v.trim()).filter(Boolean).join(' · ')],
    ] as const
  )
    .filter(([, v]) => v.trim())
    .map(([role, v]) => {
      const [name, ...rest] = v.split('·').map((x) => x.trim())
      return { role, name: name || v.trim(), phone: rest.join(' · ') || undefined }
    })

  const safety = [
    doc.day.safety_note.trim() || DEFAULT_CALL_SHEET_SAFETY,
    doc.day.safety_meeting.trim() ? `Safety meeting: ${doc.day.safety_meeting.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const setLabel = doc.places.basecamp.trim() || (opts.locationFallback ?? '').trim()
  const setNote = [
    doc.places.hmu.trim() ? `HMU: ${doc.places.hmu.trim()}` : '',
    doc.places.wardrobe.trim() ? `Wardrobe: ${doc.places.wardrobe.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const locations: StudioLocation[] =
    setLabel || doc.places.parking.trim() || doc.places.hospital.trim()
      ? [
          {
            set: { name: doc.places.basecamp.trim() ? 'Basecamp' : 'Set', address: setLabel, note: setNote || undefined },
            parking: doc.places.parking.trim() ? { name: 'Crew parking', address: doc.places.parking.trim() } : undefined,
            hospital: doc.places.hospital.trim() ? { name: 'Nearest hospital', address: doc.places.hospital.trim() } : undefined,
          },
        ]
      : []

  const schedule: StudioScheduleRow[] = []
  for (const row of doc.scenes) {
    schedule.push({ kind: 'scene', start: '', scene: row.scene, intExt: row.int_ext, description: row.description, dayNight: '', cast: row.cast, location: row.location, pages: '', est: '' })
    if (row.move.trim()) schedule.push({ kind: 'break', start: '', label: 'Move', description: row.move.trim(), est: '' })
  }

  const cast: StudioCastRow[] = opts.crew
    .filter((m) => personIsCast(doc.people[m.key]))
    .map((m, i) => {
      const c = doc.people[m.key] ?? {}
      return {
        no: c.cast_no ? String(c.cast_no) : String(i + 1),
        name: m.name || 'Member',
        character: c.character ?? '',
        status: c.status ?? '',
        pickup: c.report ?? '',
        call: personCallTime(c, general),
        hmu: c.hmu ?? '',
        onSet: c.ready ?? '',
        wrap: '',
      }
    })

  const crew: StudioCrewRow[] = opts.crew
    .filter((m) => !personIsCast(doc.people[m.key]))
    .map((m) => ({
      department: departmentForRole(m.roleLabel),
      name: m.name || 'Member',
      role: m.roleLabel,
      call: personCallTime(doc.people[m.key], general),
    }))

  const sheet: StudioCallSheet = {
    company: { name: opts.company?.name ?? '', address: opts.company?.address, logoDataUrl: opts.company?.logoUrl ?? null },
    keyContacts,
    projectTitle: opts.projectTitle,
    date: opts.shootDay,
    dayNumber: opts.dayNumber ?? null,
    dayCount: opts.dayCount ?? null,
    generalCall: general,
    safetyNote: safety,
    times: { crewCall: general, breakfast: doc.day.breakfast, shootingCall: doc.day.shoot_call, lunch: doc.day.lunch, wrap },
    notice: doc.special.trim() || undefined,
    locations,
    schedule,
    cast,
    crew,
    extras: doc.background.map((b) => ({ label: b.label, count: b.count ? String(b.count) : '', arrive: b.in ?? '', ready: b.ready ?? '' })),
    notes: [
      ...(
        [
          ['Camera', doc.departments.camera],
          ['Sound', doc.departments.sound],
          ['Wardrobe', doc.departments.wardrobe],
        ] as const
      ).map(([k, v]) => ({ title: `${k} notes`, body: v.trim() })),
      { title: 'Notes / wrap', body: (opts.notes ?? '').trim() },
      { title: 'Next shoot day', body: (opts.advanceLabel ?? '').trim() },
    ],
  }
  return buildStudioCallSheetHtml(sheet)
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
