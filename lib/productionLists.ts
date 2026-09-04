import { supabase } from '@/lib/supabase'
import { fetchCreaApi } from '@/lib/creaApiFetch'

export type ProductionTask = {
  id: string
  project_id: string
  title: string
  notes: string
  done: boolean
  position: number
  assignee_name: string
  assignee_profile_id: string | null
  assignee_manual_crew_id: string | null
}

export type ProductionEquipmentItem = {
  id: string
  project_id: string
  name: string
  qty: string
  notes: string
  unit_price: number | null
  position: number
}

export type ProductionEquipmentDraft = {
  name: string
  qty: string
  notes: string
  unit_price: number | null
}

export function formatRentalPeriodLabel(period: string, days?: number | null): string {
  const p = period.trim()
  if (!p) return ''
  if (days != null && Number.isFinite(days) && days > 0 && !/\(\s*\d+\s*days?\s*\)/i.test(p)) {
    const n = Math.round(days)
    return `${p} (${n} ${n === 1 ? 'day' : 'days'})`
  }
  return p
}

export function mergeRentalPeriodIntoNotes(period: string, notes: string): string {
  const p = period.trim()
  const n = notes.trim()
  if (!p) return n
  if (!n) return `Rental: ${p}`
  if (n.toLowerCase().includes(p.toLowerCase()) || /^rental:/i.test(n)) return n
  return `Rental: ${p}\n${n}`
}

export function rentalPeriodFromNotes(notes: string | null | undefined): string | null {
  const m = (notes ?? '').match(/^Rental:\s*(.+)$/im)
  const p = m?.[1]?.trim()
  return p ? p : null
}

export function equipmentNotesWithoutPeriod(notes: string | null | undefined): string {
  return (notes ?? '')
    .split('\n')
    .filter((line) => !/^Rental:\s*/i.test(line.trim()))
    .join('\n')
    .trim()
}

export function commonRentalPeriod(rows: { notes?: string | null }[]): string | null {
  const periods = rows
    .map((r) => rentalPeriodFromNotes(r.notes))
    .filter((p): p is string => Boolean(p))
  if (periods.length === 0) return null
  const counts = new Map<string, number>()
  for (const p of periods) counts.set(p, (counts.get(p) ?? 0) + 1)
  let best = periods[0]!
  let n = 0
  for (const [p, c] of counts) {
    if (c > n) {
      best = p
      n = c
    }
  }
  return best
}

export type TaskAssigneeInput = {
  name: string
  profileId: string | null
  manualCrewId: string | null
}

export type TaskAssigneePerson = {
  key: string
  name: string
  roleLabel: string
  profileId: string | null
  manualCrewId: string | null
}

const TASK_SELECT =
  'id, project_id, title, notes, done, position, assignee_name, assignee_profile_id, assignee_manual_crew_id'

function roleLabel(r: string) {
  if (r === 'company') return 'Client'
  if (r === 'lead') return 'Lead'
  const t = r.trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Crew'
}

function mapTask(raw: Record<string, unknown>): ProductionTask {
  return {
    id: String(raw.id),
    project_id: String(raw.project_id),
    title: String(raw.title ?? ''),
    notes: String(raw.notes ?? ''),
    done: Boolean(raw.done),
    position: typeof raw.position === 'number' ? raw.position : 0,
    assignee_name: String(raw.assignee_name ?? ''),
    assignee_profile_id: typeof raw.assignee_profile_id === 'string' ? raw.assignee_profile_id : null,
    assignee_manual_crew_id:
      typeof raw.assignee_manual_crew_id === 'string' ? raw.assignee_manual_crew_id : null,
  }
}

function mapGear(raw: Record<string, unknown>): ProductionEquipmentItem {
  const priceRaw = raw.unit_price
  const unit_price =
    typeof priceRaw === 'number' && Number.isFinite(priceRaw)
      ? priceRaw
      : typeof priceRaw === 'string' && priceRaw.trim() && Number.isFinite(Number(priceRaw))
        ? Number(priceRaw)
        : null
  return {
    id: String(raw.id),
    project_id: String(raw.project_id),
    name: String(raw.name ?? ''),
    qty: String(raw.qty ?? ''),
    notes: String(raw.notes ?? ''),
    unit_price,
    position: typeof raw.position === 'number' ? raw.position : 0,
  }
}

function emptyAssignee(): TaskAssigneeInput {
  return { name: '', profileId: null, manualCrewId: null }
}

export function assigneeFromTask(row: ProductionTask): TaskAssigneeInput {
  return {
    name: row.assignee_name.trim(),
    profileId: row.assignee_profile_id,
    manualCrewId: row.assignee_manual_crew_id,
  }
}

export function assigneeKey(a: TaskAssigneeInput): string | null {
  if (a.profileId) return `p:${a.profileId}`
  if (a.manualCrewId) return `m:${a.manualCrewId}`
  return null
}

export async function fetchTaskAssigneePeople(
  projectId: string
): Promise<{ people: TaskAssigneePerson[]; error: string | null }> {
  const [membersRes, manualRes] = await Promise.all([
    supabase
      .from('project_members')
      .select('profile_id, member_role, profiles(name)')
      .eq('project_id', projectId)
      .order('member_role', { ascending: true }),
    supabase
      .from('project_manual_crew_readable')
      .select('id, name, member_role, claimed_profile_id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
  ])

  if (membersRes.error) return { people: [], error: membersRes.error.message }

  const people: TaskAssigneePerson[] = ((membersRes.data ?? []) as Array<{
    profile_id: string
    member_role: string | null
    profiles: { name: string | null } | { name: string | null }[] | null
  }>).map((m) => {
    const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
    const name = (prof?.name && String(prof.name).trim()) || 'Member'
    return {
      key: `p:${m.profile_id}`,
      name,
      roleLabel: roleLabel(m.member_role ?? ''),
      profileId: m.profile_id,
      manualCrewId: null,
    }
  })

  const manualRows = ((manualRes.data ?? []) as Array<{
    id: string
    name: string | null
    member_role: string | null
    claimed_profile_id?: string | null
  }>).filter((m) => !(typeof m.claimed_profile_id === 'string' && m.claimed_profile_id.trim()))

  for (const m of manualRows) {
    people.push({
      key: `m:${m.id}`,
      name: (m.name && m.name.trim()) || 'Crew',
      roleLabel: (m.member_role && m.member_role.trim()) || 'Crew',
      profileId: null,
      manualCrewId: m.id,
    })
  }

  people.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return { people, error: null }
}

export async function fetchProductionTasks(projectId: string): Promise<{ rows: ProductionTask[]; error: string | null }> {
  const { data, error } = await supabase
    .from('production_tasks')
    .select(TASK_SELECT)
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { rows: [], error: error.message }
  return { rows: ((data ?? []) as Array<Record<string, unknown>>).map(mapTask), error: null }
}

export async function insertProductionTask(
  projectId: string,
  title: string,
  notes: string,
  position: number,
  assignee?: TaskAssigneeInput | null
): Promise<{ row: ProductionTask | null; error: string | null }> {
  const a = assignee ?? emptyAssignee()
  const { data, error } = await supabase
    .from('production_tasks')
    .insert({
      project_id: projectId,
      title: title.trim(),
      notes: notes.trim(),
      done: false,
      position,
      assignee_name: a.name.trim(),
      assignee_profile_id: a.profileId,
      assignee_manual_crew_id: a.manualCrewId,
    })
    .select(TASK_SELECT)
    .single()
  if (error) return { row: null, error: error.message }
  return { row: mapTask(data as Record<string, unknown>), error: null }
}

export async function updateProductionTask(
  id: string,
  patch: Partial<Pick<ProductionTask, 'title' | 'notes' | 'done'>> & {
    assignee?: TaskAssigneeInput
  }
): Promise<{ error: string | null }> {
  const body: Record<string, unknown> = {}
  if (patch.title != null) body.title = patch.title
  if (patch.notes != null) body.notes = patch.notes
  if (patch.done != null) body.done = patch.done
  if (patch.assignee) {
    body.assignee_name = patch.assignee.name.trim()
    body.assignee_profile_id = patch.assignee.profileId
    body.assignee_manual_crew_id = patch.assignee.manualCrewId
  }
  const { error } = await supabase.from('production_tasks').update(body).eq('id', id)
  return { error: error?.message ?? null }
}

export async function deleteProductionTask(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('production_tasks').delete().eq('id', id)
  return { error: error?.message ?? null }
}

export async function fetchProductionEquipment(
  projectId: string
): Promise<{ rows: ProductionEquipmentItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from('production_equipment')
    .select('id, project_id, name, qty, notes, unit_price, position')
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { rows: [], error: error.message }
  return { rows: ((data ?? []) as Array<Record<string, unknown>>).map(mapGear), error: null }
}

export async function insertProductionEquipment(
  projectId: string,
  name: string,
  qty: string,
  notes: string,
  position: number,
  unitPrice: number | null = null
): Promise<{ row: ProductionEquipmentItem | null; error: string | null }> {
  const { data, error } = await supabase
    .from('production_equipment')
    .insert({
      project_id: projectId,
      name: name.trim(),
      qty: qty.trim(),
      notes: notes.trim(),
      unit_price: unitPrice,
      position,
    })
    .select('id, project_id, name, qty, notes, unit_price, position')
    .single()
  if (error) return { row: null, error: error.message }
  return { row: mapGear(data as Record<string, unknown>), error: null }
}

export async function insertProductionEquipmentMany(
  projectId: string,
  items: ProductionEquipmentDraft[],
  startPosition: number
): Promise<{ rows: ProductionEquipmentItem[]; error: string | null }> {
  if (items.length === 0) return { rows: [], error: null }
  const payload = items.map((it, i) => ({
    project_id: projectId,
    name: it.name.trim(),
    qty: it.qty.trim(),
    notes: it.notes.trim(),
    unit_price: it.unit_price,
    position: startPosition + i,
  }))
  const { data, error } = await supabase
    .from('production_equipment')
    .insert(payload)
    .select('id, project_id, name, qty, notes, unit_price, position')
  if (error) return { rows: [], error: error.message }
  const mapped = ((data ?? []) as Array<Record<string, unknown>>).map(mapGear)
  mapped.sort((a, b) => a.position - b.position)
  return { rows: mapped, error: null }
}

export function parseOptionalUnitPrice(raw: string): number | null {
  const t = raw.trim().replace(/\s+/g, '')
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

export function unitPriceToInput(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return ''
  return String(n)
}

export async function fetchProjectBudgetCurrency(projectId: string): Promise<string> {
  const { data } = await supabase
    .from('project_budget_plans')
    .select('currency')
    .eq('project_id', projectId)
    .maybeSingle()
  const c = typeof data?.currency === 'string' ? data.currency.trim() : ''
  return c || 'EUR'
}

export async function updateProductionEquipment(
  id: string,
  patch: Partial<Pick<ProductionEquipmentItem, 'name' | 'qty' | 'notes' | 'unit_price'>>
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('production_equipment').update(patch).eq('id', id)
  return { error: error?.message ?? null }
}

export async function deleteProductionEquipment(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('production_equipment').delete().eq('id', id)
  return { error: error?.message ?? null }
}

export async function importRentalPdf(
  projectId: string,
  file: { uri: string; name: string; mimeType?: string }
): Promise<{ rows: ProductionEquipmentItem[]; error: string | null; count: number; rental_period: string | null }> {
  const fd = new FormData()
  fd.append('projectId', projectId)
  fd.append('file', {
    uri: file.uri,
    name: file.name || 'quote.pdf',
    type: file.mimeType || 'application/pdf',
  } as unknown as Blob)
  const { data, error, status } = await fetchCreaApi<{
    ok?: boolean
    error?: string
    rows?: ProductionEquipmentItem[]
    count?: number
    rental_period?: string | null
  }>('/api/app/equipment/parse-rental-pdf', {
    method: 'POST',
    body: fd,
    timeoutMs: 90_000,
  })
  if (error || !data?.ok) {
    const msg =
      (typeof data?.error === 'string' && data.error) ||
      (error === 'timeout'
        ? 'The PDF is taking too long to read. Try a shorter quote.'
        : error === 'missing_web_url'
          ? 'PDF import needs the CREA web URL.'
          : error === 'no_session'
            ? 'Please sign in again.'
            : error) ||
      `Could not read PDF (${status})`
    return { rows: [], error: msg, count: 0, rental_period: null }
  }
  const rows = Array.isArray(data.rows) ? data.rows : []
  const rental_period =
    typeof data.rental_period === 'string' && data.rental_period.trim()
      ? data.rental_period.trim()
      : commonRentalPeriod(rows)
  return { rows, error: null, count: data.count ?? rows.length, rental_period }
}
