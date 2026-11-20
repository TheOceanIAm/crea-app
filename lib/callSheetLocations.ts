import {
  CALL_SHEET_CLOCK_RE,
  CALL_SHEET_LOCATION_ADDRESS_LIMIT,
  CALL_SHEET_LOCATION_LIMIT,
  CALL_SHEET_LOCATION_NAME_LIMIT,
  CALL_SHEET_LOCATION_NOTES_LIMIT,
  type CallSheetLocation,
  type CallSheetSceneRow,
} from '@/lib/callSheet'

export const CALL_SHEET_LOCATION_LIMIT_HINT = '30 locations is the maximum.'

/** Build-time flag. Unset means the shoot-location editor stays hidden. */
export function callSheetShootLocationsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_CALL_SHEET_LOCATIONS === '1'
}

export function clipCallSheetLocationFields(input: { name: string; address: string; notes: string }): {
  name: string
  address: string
  notes: string
} {
  return {
    name: input.name.slice(0, CALL_SHEET_LOCATION_NAME_LIMIT),
    address: input.address.slice(0, CALL_SHEET_LOCATION_ADDRESS_LIMIT),
    notes: input.notes.slice(0, CALL_SHEET_LOCATION_NOTES_LIMIT),
  }
}

/** Indexes for display. Untimed scenes stay last. The stored array is not reordered. */
export function callSheetSceneDisplayOrder(scenes: CallSheetSceneRow[]): number[] {
  return scenes
    .map((scene, index) => ({ index, time: (scene.time ?? '').trim() }))
    .sort((a, b) => {
      const aOk = CALL_SHEET_CLOCK_RE.test(a.time)
      const bOk = CALL_SHEET_CLOCK_RE.test(b.time)
      if (aOk && bOk && a.time !== b.time) return a.time < b.time ? -1 : 1
      if (aOk !== bOk) return aOk ? -1 : 1
      return a.index - b.index
    })
    .map((row) => row.index)
}

export function scenesUsingCallSheetLocation(scenes: CallSheetSceneRow[], locationId: string): number {
  return scenes.filter((row) => row.location_id === locationId).length
}

/** Drop the link and keep the location name as the scene's written location. */
export function unlinkCallSheetLocation(scenes: CallSheetSceneRow[], location: CallSheetLocation): CallSheetSceneRow[] {
  const name = location.name.trim()
  return scenes.map((row) => {
    if (row.location_id !== location.id) return row
    return { ...row, location_id: '', location: name || row.location }
  })
}

export function moveCallSheetLocation(
  locations: CallSheetLocation[],
  index: number,
  direction: -1 | 1,
): CallSheetLocation[] {
  const next = index + direction
  if (index < 0 || next < 0 || index >= locations.length || next >= locations.length) return locations
  const copy = locations.slice()
  const [item] = copy.splice(index, 1)
  copy.splice(next, 0, item)
  return copy
}

export function callSheetSceneLocationLabel(row: CallSheetSceneRow, locations: CallSheetLocation[]): string {
  const linked = row.location_id ? locations.find((loc) => loc.id === row.location_id) : undefined
  return linked?.name.trim() || row.location.trim()
}

/** Maps link built only from the address text. Empty address returns null. */
export function callSheetMapsUrl(address: string, target: 'web' | 'ios' | 'android'): string | null {
  const query = address.trim()
  if (!query) return null
  const encoded = encodeURIComponent(query)
  if (target === 'web') return `https://www.google.com/maps/search/?api=1&query=${encoded}`
  if (target === 'ios') return `maps://?q=${encoded}`
  return `geo:0,0?q=${encoded}`
}

export function canAddCallSheetLocation(count: number): boolean {
  return count < CALL_SHEET_LOCATION_LIMIT
}

export function newCallSheetLocationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16)
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8
    return value.toString(16)
  })
}
