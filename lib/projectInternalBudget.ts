import { memberBookedSlotsFromRow } from '@/lib/memberBookedDates'

export type CrewSpendMemberRow = {
  profile_id?: string
  member_role: string
  booked_dates?: unknown
  scheduling_start_date?: string | null
  scheduling_end_date?: string | null
  /** Project-local rates for external/manual crew (no Crea profile). */
  day_rate_amount?: number | null
  half_day_rate_amount?: number | null
  display_name?: string | null
  profiles: {
    name?: string | null
    day_rate_amount?: number | null
    half_day_rate_amount?: number | null
    rates_currency?: string | null
  } | null
}

export type CrewSpendLine = {
  profileIdKey: string
  displayName: string
  /** Sum of booked units (1 = full day, 0.5 = half day, etc.). */
  dayUnits: number
  dayRate: number
  halfDayRate: number | null
  profileCurrency: string | null
  subtotal: number
  currencyMatchesPlan: boolean
}

function normCurrency(c: string | null | undefined): string {
  return (c ?? 'EUR').trim().toUpperCase() || 'EUR'
}

/** Cost for one calendar slot (units ≤ 1); uses profile half-day rate when units ≈ 0.5 if set. */
export function crewCostForBookedUnits(
  units: number,
  dayRate: number,
  halfDayRate: number | null | undefined,
): number {
  if (units <= 0 || dayRate <= 0) return 0
  const u = Math.min(units, 1)
  if (Math.abs(u - 0.5) < 1e-9) {
    const half =
      typeof halfDayRate === 'number' && !Number.isNaN(halfDayRate) && halfDayRate > 0 ? halfDayRate : 0.5 * dayRate
    return Math.round(half * 100) / 100
  }
  if (u >= 1) return Math.round(dayRate * 100) / 100
  return Math.round(u * dayRate * 100) / 100
}

/** Registered crew/lead (not client row): booked units × profile day / half-day rates. */
export function computeCrewSpendLines(
  rows: CrewSpendMemberRow[],
  planCurrency: string,
): { lines: CrewSpendLine[]; total: number; currenciesMixed: boolean } {
  const pc = normCurrency(planCurrency)
  const lines: CrewSpendLine[] = []
  let currenciesMixed = false

  rows.forEach((row, idx) => {
    if ((row.member_role ?? '').toLowerCase() === 'company') return
    const slots = memberBookedSlotsFromRow(row)
    const localDay =
      typeof row.day_rate_amount === 'number' && !Number.isNaN(row.day_rate_amount) && row.day_rate_amount > 0
        ? row.day_rate_amount
        : null
    const dayRate =
      localDay ?? (typeof row.profiles?.day_rate_amount === 'number' ? row.profiles.day_rate_amount : 0)
    const halfRaw =
      typeof row.half_day_rate_amount === 'number' &&
      !Number.isNaN(row.half_day_rate_amount) &&
      row.half_day_rate_amount > 0
        ? row.half_day_rate_amount
        : row.profiles?.half_day_rate_amount
    const halfDayRate =
      typeof halfRaw === 'number' && !Number.isNaN(halfRaw) && halfRaw > 0 ? halfRaw : null
    const profCur = row.profiles?.rates_currency != null ? normCurrency(row.profiles.rates_currency) : pc
    if (profCur !== pc) currenciesMixed = true

    let subtotal = 0
    for (const { units } of slots) {
      subtotal += crewCostForBookedUnits(units, dayRate, halfDayRate)
    }
    subtotal = Math.round(subtotal * 100) / 100
    const dayUnits = Math.round(slots.reduce((s, e) => s + e.units, 0) * 100) / 100

    if (dayUnits === 0 && dayRate === 0) return
    const name = (row.profiles?.name ?? '').trim() || (row.display_name ?? '').trim() || 'Crew member'
    lines.push({
      profileIdKey: row.profile_id ?? `manual-${idx}`,
      displayName: name,
      dayUnits,
      dayRate,
      halfDayRate,
      profileCurrency: row.profiles?.rates_currency ?? null,
      subtotal,
      currencyMatchesPlan: profCur === pc,
    })
  })

  const total = Math.round(lines.reduce((s, l) => s + l.subtotal, 0) * 100) / 100
  return { lines, total, currenciesMixed }
}

export type EquipmentSpendRow = {
  id: string
  name: string
  qty: string
  unit_price: number | null
  notes?: string | null
}

export type EquipmentSpendLine = {
  id: string
  displayName: string
  qty: number
  unitPrice: number
  subtotal: number
  period: string | null
}

/** First positive number in qty text; empty / unparseable → 1. */
export function parseEquipmentQty(qty: string | null | undefined): number {
  const t = (qty ?? '').trim()
  if (!t) return 1
  const m = t.replace(',', '.').match(/\d+(?:\.\d+)?/)
  if (!m) return 1
  const n = Number(m[0])
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function equipmentLineTotal(qty: string, unitPrice: number | null | undefined): number {
  if (unitPrice == null || !Number.isFinite(unitPrice) || unitPrice <= 0) return 0
  return Math.round(parseEquipmentQty(qty) * unitPrice * 100) / 100
}

/** Live kit-list spend: qty × unit_price. Items without a price are omitted. */
export function computeEquipmentSpend(rows: EquipmentSpendRow[]): { lines: EquipmentSpendLine[]; total: number } {
  const lines: EquipmentSpendLine[] = []
  for (const r of rows) {
    const price = r.unit_price
    if (price == null || !Number.isFinite(price) || price <= 0) continue
    const qty = parseEquipmentQty(r.qty)
    const subtotal = Math.round(qty * price * 100) / 100
    const periodMatch = (r.notes ?? '').match(/^Rental:\s*(.+)$/im)
    lines.push({
      id: r.id,
      displayName: (r.name ?? '').trim() || 'Equipment',
      qty,
      unitPrice: price,
      subtotal,
      period: periodMatch?.[1]?.trim() || null,
    })
  }
  const total = Math.round(lines.reduce((s, l) => s + l.subtotal, 0) * 100) / 100
  return { lines, total }
}

export function sumBudgetLineSpent(
  rows: { spent_amount?: number | null; planned_amount?: number | null }[],
): { spent: number; planned: number } {
  let spent = 0
  let planned = 0
  for (const r of rows) {
    const s = typeof r.spent_amount === 'number' && !Number.isNaN(r.spent_amount) ? r.spent_amount : 0
    const p = typeof r.planned_amount === 'number' && !Number.isNaN(r.planned_amount) ? r.planned_amount : 0
    spent += s
    planned += p
  }
  return {
    spent: Math.round(spent * 100) / 100,
    planned: Math.round(planned * 100) / 100,
  }
}

/** Remaining headroom while planning — crew + kit list + planned other expenses vs total budget. */
export function computeForecastRemaining(
  totalBudget: number | null,
  crewTotal: number,
  otherPlanned: number,
  equipmentTotal = 0,
): number | null {
  if (totalBudget == null) return null
  return Math.round((totalBudget - crewTotal - equipmentTotal - otherPlanned) * 100) / 100
}

/** Post-shoot balance — crew + kit list + actual other spend vs total budget (negative = over budget). */
export function computeWrapUpVariance(
  totalBudget: number | null,
  crewTotal: number,
  otherSpent: number,
  equipmentTotal = 0,
): number | null {
  if (totalBudget == null) return null
  return Math.round((totalBudget - crewTotal - equipmentTotal - otherSpent) * 100) / 100
}

/** Logged timesheet hours that equal one booked day. */
export const TIMESHEET_HOURS_PER_DAY = 10

export type TimesheetHourEntry = {
  personKey: string
  workDate: string
  hours: number
}

export type TimesheetPerson = {
  key: string
  name: string
  profileId: string | null
  manualCrewId: string | null
  bookedDates: { date: string; units: number }[]
}

export type CurrentCrewCost = {
  logged: number
  open: number
  projected: number
  loggedHours: number
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function crewRates(row: CrewSpendMemberRow): { dayRate: number; halfDayRate: number | null } {
  const localDay =
    typeof row.day_rate_amount === 'number' && !Number.isNaN(row.day_rate_amount) && row.day_rate_amount > 0
      ? row.day_rate_amount
      : null
  const dayRate = localDay ?? (typeof row.profiles?.day_rate_amount === 'number' ? row.profiles.day_rate_amount : 0)
  const halfRaw =
    typeof row.half_day_rate_amount === 'number' &&
    !Number.isNaN(row.half_day_rate_amount) &&
    row.half_day_rate_amount > 0
      ? row.half_day_rate_amount
      : row.profiles?.half_day_rate_amount
  const halfDayRate = typeof halfRaw === 'number' && !Number.isNaN(halfRaw) && halfRaw > 0 ? halfRaw : null
  return { dayRate, halfDayRate }
}

/** Straight time against the day rate. Ten hours = one day. */
export function crewCostForLoggedHours(hours: number, dayRate: number): number {
  if (!(hours > 0) || !(dayRate > 0)) return 0
  return roundMoney(dayRate * (hours / TIMESHEET_HOURS_PER_DAY))
}

export function timesheetPeopleFromMembers(rows: CrewSpendMemberRow[]): TimesheetPerson[] {
  const people: TimesheetPerson[] = []
  for (const row of rows) {
    if ((row.member_role ?? '').toLowerCase() === 'company') continue
    const key = (row.profile_id ?? '').trim()
    if (!key) continue
    const manual = key.startsWith('manual:') ? key.slice('manual:'.length) : null
    people.push({
      key,
      name: (row.profiles?.name ?? '').trim() || (row.display_name ?? '').trim() || 'Crew member',
      profileId: manual ? null : key,
      manualCrewId: manual,
      bookedDates: memberBookedSlotsFromRow(row).map((slot) => ({ date: slot.date, units: slot.units })),
    })
  }
  return people
}

export function visibleTimesheetDates(person: TimesheetPerson, entries: readonly TimesheetHourEntry[]): string[] {
  const dates = new Set(person.bookedDates.map((d) => d.date))
  for (const entry of entries) {
    if (entry.personKey !== person.key || !(entry.hours > 0)) continue
    const date = entry.workDate.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.add(date)
  }
  return [...dates].sort()
}

/**
 * During the shoot: logged hours replace that day's booked cost.
 * Booked days with no hours stay on the plan. Extra logged days are added.
 */
export function computeCurrentCrewCost(
  rows: CrewSpendMemberRow[],
  entries: readonly TimesheetHourEntry[],
): CurrentCrewCost {
  const hoursByPerson = new Map<string, Map<string, number>>()
  for (const entry of entries) {
    if (!(entry.hours > 0)) continue
    const date = entry.workDate.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const byDate = hoursByPerson.get(entry.personKey) ?? new Map<string, number>()
    byDate.set(date, entry.hours)
    hoursByPerson.set(entry.personKey, byDate)
  }

  let logged = 0
  let open = 0
  let loggedHours = 0

  for (const row of rows) {
    if ((row.member_role ?? '').toLowerCase() === 'company') continue
    const key = (row.profile_id ?? '').trim()
    if (!key) continue
    const { dayRate, halfDayRate } = crewRates(row)
    const loggedDates = hoursByPerson.get(key) ?? new Map<string, number>()
    for (const slot of memberBookedSlotsFromRow(row)) {
      if (loggedDates.has(slot.date)) continue
      open += crewCostForBookedUnits(slot.units, dayRate, halfDayRate)
    }
    for (const hours of loggedDates.values()) {
      loggedHours += hours
      logged += crewCostForLoggedHours(hours, dayRate)
    }
  }

  return {
    logged: roundMoney(logged),
    open: roundMoney(open),
    projected: roundMoney(logged + open),
    loggedHours: roundMoney(loggedHours),
  }
}

/** Actual other spend when entered (> 0); otherwise the planned amount. */
export function computeCurrentOtherSpend(
  rows: { spent_amount?: number | null; planned_amount?: number | null }[],
): number {
  let sum = 0
  for (const row of rows) {
    const planned = typeof row.planned_amount === 'number' && !Number.isNaN(row.planned_amount) ? row.planned_amount : 0
    const spent = typeof row.spent_amount === 'number' && !Number.isNaN(row.spent_amount) ? row.spent_amount : 0
    sum += spent > 0 ? spent : planned
  }
  return roundMoney(sum)
}

/** Headroom while shooting — projected crew + kit + current other vs total budget. */
export function computeCurrentHeadroom(
  totalBudget: number | null,
  crewProjected: number,
  otherCurrent: number,
  equipmentTotal = 0,
): number | null {
  if (totalBudget == null) return null
  return roundMoney(totalBudget - crewProjected - equipmentTotal - otherCurrent)
}

export function budgetVarianceTone(variance: number | null): 'neutral' | 'under' | 'over' {
  if (variance == null) return 'neutral'
  if (variance < 0) return 'over'
  if (variance > 0) return 'under'
  return 'neutral'
}

export function formatMoneyAmount(amount: number | null | undefined, currency = 'EUR'): string {
  const n = typeof amount === 'number' && !Number.isNaN(amount) ? amount : 0
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(n)
  } catch {
    return `${n.toFixed(0)} ${currency}`
  }
}
