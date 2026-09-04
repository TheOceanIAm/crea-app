import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native'
import { Check, Plus, Trash2, Upload } from 'lucide-react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { ICON_STROKE } from '@/lib/iconTheme'
import { KeyboardFormModal } from '@/components/KeyboardFormModal'
import {
  assigneeFromTask,
  assigneeKey,
  deleteProductionEquipment,
  deleteProductionTask,
  fetchProductionEquipment,
  fetchProductionTasks,
  fetchProjectBudgetCurrency,
  fetchTaskAssigneePeople,
  importRentalPdf,
  insertProductionEquipment,
  insertProductionTask,
  parseOptionalUnitPrice,
  commonRentalPeriod,
  equipmentNotesWithoutPeriod,
  rentalPeriodFromNotes,
  unitPriceToInput,
  updateProductionEquipment,
  updateProductionTask,
  type ProductionEquipmentItem,
  type ProductionTask,
  type TaskAssigneeInput,
  type TaskAssigneePerson,
} from '@/lib/productionLists'
import { equipmentLineTotal, formatMoneyAmount } from '@/lib/projectInternalBudget'

type DocumentPickerModule = {
  getDocumentAsync: (opts?: {
    type?: string | string[]
    copyToCacheDirectory?: boolean
  }) => Promise<
    | { canceled: true; assets: null }
    | { canceled: false; assets: { uri: string; name?: string; mimeType?: string; size?: number }[] }
  >
}

let documentPickerLoad: DocumentPickerModule | false | undefined

function getDocumentPicker(): DocumentPickerModule | null {
  if (documentPickerLoad === false) return null
  if (documentPickerLoad) return documentPickerLoad
  if (Platform.OS !== 'web' && requireOptionalNativeModule('ExpoDocumentPicker') == null) {
    documentPickerLoad = false
    return null
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    documentPickerLoad = require('expo-document-picker') as DocumentPickerModule
    return documentPickerLoad
  } catch {
    documentPickerLoad = false
    return null
  }
}

type ListProps = {
  projectId: string
  readOnly?: boolean
  offlineTasks?: ProductionTask[] | null
  offlineEquipment?: ProductionEquipmentItem[] | null
}

function resolveAssignee(
  people: TaskAssigneePerson[],
  selectedKey: string | null,
  customName: string
): TaskAssigneeInput {
  if (selectedKey) {
    const p = people.find((x) => x.key === selectedKey)
    if (p) return { name: p.name, profileId: p.profileId, manualCrewId: p.manualCrewId }
  }
  return { name: customName.trim(), profileId: null, manualCrewId: null }
}

function AssigneePicker({
  people,
  selectedKey,
  customName,
  onSelectKey,
  onChangeCustom,
}: {
  people: TaskAssigneePerson[]
  selectedKey: string | null
  customName: string
  onSelectKey: (key: string | null) => void
  onChangeCustom: (name: string) => void
}) {
  return (
    <View style={styles.assigneeBlock}>
      <Text style={styles.assigneeLabel}>Assigned to</Text>
      {people.length > 0 ? (
        <View style={styles.chipWrap}>
          <TouchableOpacity
            style={[styles.chip, !selectedKey && !customName.trim() && styles.chipOn]}
            onPress={() => {
              onSelectKey(null)
              onChangeCustom('')
            }}
          >
            <Text style={[styles.chipText, !selectedKey && !customName.trim() && styles.chipTextOn]}>Unassigned</Text>
          </TouchableOpacity>
          {people.map((p) => {
            const on = selectedKey === p.key
            return (
              <TouchableOpacity
                key={p.key}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => {
                  onSelectKey(on ? null : p.key)
                  onChangeCustom('')
                }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ) : null}
      <TextInput
        style={styles.input}
        placeholder={people.length > 0 ? 'Or type a name' : 'Name (optional)'}
        placeholderTextColor="rgba(255,255,255,0.25)"
        value={customName}
        onChangeText={(t) => {
          onChangeCustom(t)
          if (t.trim()) onSelectKey(null)
        }}
      />
    </View>
  )
}

export function ProductionTasksSection({ projectId, readOnly = false, offlineTasks }: ListProps) {
  const [rows, setRows] = useState<ProductionTask[]>([])
  const [people, setPeople] = useState<TaskAssigneePerson[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')
  const [busy, setBusy] = useState(false)
  const [editRow, setEditRow] = useState<ProductionTask | null>(null)
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editCustom, setEditCustom] = useState('')
  const [editBusy, setEditBusy] = useState(false)

  const load = useCallback(async () => {
    if (offlineTasks) {
      setRows(offlineTasks)
      setLoading(false)
      return
    }
    const [{ rows: next, error }, crew] = await Promise.all([
      fetchProductionTasks(projectId),
      fetchTaskAssigneePeople(projectId),
    ])
    if (error) Alert.alert('Tasks', error)
    if (crew.error) console.warn('[Tasks] crew', crew.error)
    setRows(next)
    setPeople(crew.people)
    setLoading(false)
  }, [offlineTasks, projectId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const add = async () => {
    const t = title.trim()
    if (!t || busy || readOnly) return
    setBusy(true)
    const assignee = resolveAssignee(people, selectedKey, customName)
    const { row, error } = await insertProductionTask(projectId, t, notes, rows.length, assignee)
    setBusy(false)
    if (error || !row) {
      Alert.alert('Tasks', error ?? 'Could not add task.')
      return
    }
    setRows((prev) => [...prev, row])
    setTitle('')
    setNotes('')
    setSelectedKey(null)
    setCustomName('')
  }

  const toggle = async (row: ProductionTask) => {
    if (readOnly) return
    const next = !row.done
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, done: next } : r)))
    const { error } = await updateProductionTask(row.id, { done: next })
    if (error) {
      Alert.alert('Tasks', error)
      void load()
    }
  }

  const openAssign = (row: ProductionTask) => {
    if (readOnly) return
    const current = assigneeFromTask(row)
    const key = assigneeKey(current)
    const matched = key && people.some((p) => p.key === key)
    setEditRow(row)
    setEditKey(matched ? key : null)
    setEditCustom(matched ? '' : current.name)
  }

  const saveAssign = async () => {
    if (!editRow || editBusy) return
    setEditBusy(true)
    const assignee = resolveAssignee(people, editKey, editCustom)
    const { error } = await updateProductionTask(editRow.id, { assignee })
    setEditBusy(false)
    if (error) {
      Alert.alert('Tasks', error)
      return
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === editRow.id
          ? {
              ...r,
              assignee_name: assignee.name,
              assignee_profile_id: assignee.profileId,
              assignee_manual_crew_id: assignee.manualCrewId,
            }
          : r
      )
    )
    setEditRow(null)
  }

  const remove = (row: ProductionTask) => {
    if (readOnly) return
    Alert.alert('Remove task', row.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const { error } = await deleteProductionTask(row.id)
            if (error) {
              Alert.alert('Tasks', error)
              return
            }
            setRows((prev) => prev.filter((r) => r.id !== row.id))
          })()
        },
      },
    ])
  }

  const peopleByKey = useMemo(() => new Map(people.map((p) => [p.key, p])), [people])

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  return (
    <View>
      <Text style={styles.lead}>Checklist for this production. Shared with the whole team.</Text>
      {!readOnly ? (
        <View style={styles.addCard}>
          <TextInput
            style={styles.input}
            placeholder="Task (e.g. Confirm location access)"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={title}
            onChangeText={setTitle}
            onSubmitEditing={() => void add()}
          />
          <AssigneePicker
            people={people}
            selectedKey={selectedKey}
            customName={customName}
            onSelectKey={setSelectedKey}
            onChangeCustom={setCustomName}
          />
          <TextInput
            style={styles.input}
            placeholder="Notes (optional)"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={notes}
            onChangeText={setNotes}
          />
          <TouchableOpacity style={[styles.addBtn, busy && styles.dim]} onPress={() => void add()} disabled={busy}>
            <Plus size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
            <Text style={styles.addBtnText}>Add task</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {rows.length === 0 ? (
        <Text style={styles.empty}>No tasks yet.</Text>
      ) : (
        rows.map((row) => {
          const key = assigneeKey(assigneeFromTask(row))
          const person = key ? peopleByKey.get(key) : undefined
          const who = row.assignee_name.trim()
          return (
            <View key={row.id} style={styles.row}>
              <TouchableOpacity style={styles.checkBtn} onPress={() => void toggle(row)} disabled={readOnly}>
                <View style={[styles.check, row.done && styles.checkOn]}>
                  {row.done ? <Check size={12} color="#0a0a0a" strokeWidth={ICON_STROKE} /> : null}
                </View>
              </TouchableOpacity>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, row.done && styles.rowTitleDone]}>{row.title}</Text>
                <TouchableOpacity onPress={() => openAssign(row)} disabled={readOnly} hitSlop={6}>
                  <Text style={who ? styles.assigneeLine : styles.assigneeLineMuted}>
                    {who ? who : readOnly ? 'Unassigned' : 'Assign someone'}
                    {person?.roleLabel ? `  ·  ${person.roleLabel}` : ''}
                  </Text>
                </TouchableOpacity>
                {row.notes.trim() ? <Text style={styles.rowNotes}>{row.notes}</Text> : null}
              </View>
              {!readOnly ? (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => remove(row)} hitSlop={8}>
                  <Trash2 size={16} color="#f87171" strokeWidth={ICON_STROKE} />
                </TouchableOpacity>
              ) : null}
            </View>
          )
        })
      )}

      <KeyboardFormModal visible={Boolean(editRow)} onClose={() => setEditRow(null)}>
        <Text style={styles.modalTitle}>Assigned to</Text>
        {editRow ? <Text style={styles.modalSub}>{editRow.title}</Text> : null}
        <AssigneePicker
          people={people}
          selectedKey={editKey}
          customName={editCustom}
          onSelectKey={setEditKey}
          onChangeCustom={setEditCustom}
        />
        <TouchableOpacity
          style={[styles.addBtn, editBusy && styles.dim]}
          onPress={() => void saveAssign()}
          disabled={editBusy}
        >
          <Text style={styles.addBtnText}>{editBusy ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </KeyboardFormModal>
    </View>
  )
}

export function ProductionEquipmentSection({ projectId, readOnly = false, offlineEquipment }: ListProps) {
  const [rows, setRows] = useState<ProductionEquipmentItem[]>([])
  const [currency, setCurrency] = useState('EUR')
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [priceStr, setPriceStr] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [editRow, setEditRow] = useState<ProductionEquipmentItem | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)

  const load = useCallback(async () => {
    if (offlineEquipment) {
      setRows(offlineEquipment)
      setLoading(false)
      return
    }
    const [{ rows: next, error }, cur] = await Promise.all([
      fetchProductionEquipment(projectId),
      fetchProjectBudgetCurrency(projectId),
    ])
    if (error) Alert.alert('Equipment', error)
    setRows(next)
    setCurrency(cur)
    setLoading(false)
  }, [offlineEquipment, projectId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const add = async () => {
    const t = name.trim()
    if (!t || busy || readOnly) return
    setBusy(true)
    const { row, error } = await insertProductionEquipment(
      projectId,
      t,
      qty,
      notes,
      rows.length,
      parseOptionalUnitPrice(priceStr)
    )
    setBusy(false)
    if (error || !row) {
      Alert.alert('Equipment', error ?? 'Could not add item.')
      return
    }
    setRows((prev) => [...prev, row])
    setName('')
    setQty('')
    setPriceStr('')
    setNotes('')
  }

  const openPrice = (row: ProductionEquipmentItem) => {
    if (readOnly) return
    setEditRow(row)
    setEditQty(row.qty)
    setEditPrice(unitPriceToInput(row.unit_price))
  }

  const savePrice = async () => {
    if (!editRow || editBusy) return
    setEditBusy(true)
    const qtyNext = editQty.trim()
    const priceNext = parseOptionalUnitPrice(editPrice)
    const { error } = await updateProductionEquipment(editRow.id, { qty: qtyNext, unit_price: priceNext })
    setEditBusy(false)
    if (error) {
      Alert.alert('Equipment', error)
      return
    }
    setRows((prev) =>
      prev.map((r) => (r.id === editRow.id ? { ...r, qty: qtyNext, unit_price: priceNext } : r))
    )
    setEditRow(null)
  }

  const remove = (row: ProductionEquipmentItem) => {
    if (readOnly) return
    Alert.alert('Remove item', row.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const { error } = await deleteProductionEquipment(row.id)
            if (error) {
              Alert.alert('Equipment', error)
              return
            }
            setRows((prev) => prev.filter((r) => r.id !== row.id))
          })()
        },
      },
    ])
  }

  const importPdf = async () => {
    if (readOnly || pdfBusy) return
    const DP = getDocumentPicker()
    if (!DP) {
      Alert.alert(
        'PDF import',
        'This install cannot pick documents yet. Upload the rental PDF from the web workspace (Equipment), or use a development build with the document picker.'
      )
      return
    }
    const picked = await DP.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
    if (picked.canceled || !picked.assets?.[0]) return
    const asset = picked.assets[0]
    const name = (asset.name ?? 'quote.pdf').toLowerCase()
    if (!name.endsWith('.pdf') && !(asset.mimeType ?? '').includes('pdf')) {
      Alert.alert('PDF import', 'Please pick a PDF rental quote.')
      return
    }
    if (typeof asset.size === 'number' && asset.size > 4 * 1024 * 1024) {
      Alert.alert('PDF import', 'PDF must be 4 MB or smaller.')
      return
    }
    setPdfBusy(true)
    const { rows: added, error, count, rental_period } = await importRentalPdf(projectId, {
      uri: asset.uri,
      name: asset.name || 'quote.pdf',
      mimeType: asset.mimeType,
    })
    setPdfBusy(false)
    if (error) {
      Alert.alert('PDF import', error)
      return
    }
    setRows((prev) => [...prev, ...added])
    const addedMsg = count === 1 ? 'Added 1 item from the quote.' : `Added ${count} items from the quote.`
    Alert.alert('Equipment', rental_period ? `${addedMsg}\nRental: ${rental_period}` : addedMsg)
  }

  const sharedPeriod = useMemo(() => commonRentalPeriod(rows), [rows])

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  return (
    <View>
      <Text style={styles.lead}>
        Kit list for this production. Upload a rental PDF to fill names, qty, and prices — they roll into Budget
        automatically. Don’t add a second Equipment line there unless it’s extra kit not on this list.
      </Text>
      {!readOnly ? (
        <View style={styles.addCard}>
          <TouchableOpacity
            style={[styles.pdfBtn, pdfBusy && styles.dim]}
            onPress={() => void importPdf()}
            disabled={pdfBusy}
          >
            {pdfBusy ? (
              <ActivityIndicator color="#FFDC00" />
            ) : (
              <Upload size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
            )}
            <Text style={styles.pdfBtnText}>{pdfBusy ? 'Reading PDF…' : 'Upload rental PDF'}</Text>
          </TouchableOpacity>
          <Text style={styles.pdfHint}>Quote is added to this list. Existing items stay. Rental dates from the PDF are saved on the list.</Text>
          <TextInput
            style={styles.input}
            placeholder="Item (e.g. Alexa Mini)"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => void add()}
          />
          <View style={styles.rowInputs}>
            <TextInput
              style={[styles.input, styles.inputFlex]}
              placeholder="Qty (optional)"
              placeholderTextColor="rgba(255,255,255,0.25)"
              value={qty}
              onChangeText={setQty}
            />
            <TextInput
              style={[styles.input, styles.inputFlex]}
              placeholder={`Price (${currency})`}
              placeholderTextColor="rgba(255,255,255,0.25)"
              value={priceStr}
              onChangeText={setPriceStr}
              keyboardType="decimal-pad"
            />
          </View>
          <TextInput
            style={styles.input}
            placeholder="Notes (optional)"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={notes}
            onChangeText={setNotes}
          />
          <TouchableOpacity style={[styles.addBtn, busy && styles.dim]} onPress={() => void add()} disabled={busy}>
            <Plus size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
            <Text style={styles.addBtnText}>Add item</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {rows.length === 0 ? (
        <Text style={styles.empty}>No equipment yet.</Text>
      ) : (
        <>
          {sharedPeriod ? (
            <View style={styles.periodBanner}>
              <Text style={styles.periodKicker}>Rental period</Text>
              <Text style={styles.periodText}>{sharedPeriod}</Text>
            </View>
          ) : null}
          {rows.map((row) => {
          const line = equipmentLineTotal(row.qty, row.unit_price)
          const hasPrice = row.unit_price != null && row.unit_price > 0
          const period = rentalPeriodFromNotes(row.notes)
          const extraNotes = equipmentNotesWithoutPeriod(row.notes)
          return (
            <View key={row.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>
                  {row.name}
                  {row.qty.trim() ? <Text style={styles.qty}>  ·  {row.qty.trim()}</Text> : null}
                </Text>
                <TouchableOpacity onPress={() => openPrice(row)} disabled={readOnly} hitSlop={6}>
                  <Text style={hasPrice ? styles.assigneeLine : styles.assigneeLineMuted}>
                    {hasPrice
                      ? `${formatMoneyAmount(row.unit_price, currency)} × ${row.qty.trim() || '1'}  =  ${formatMoneyAmount(line, currency)}`
                      : readOnly
                        ? 'No price'
                        : 'Add price'}
                  </Text>
                </TouchableOpacity>
                {period && period !== sharedPeriod ? <Text style={styles.periodRow}>{period}</Text> : null}
                {extraNotes ? <Text style={styles.rowNotes}>{extraNotes}</Text> : null}
              </View>
              {!readOnly ? (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => remove(row)} hitSlop={8}>
                  <Trash2 size={16} color="#f87171" strokeWidth={ICON_STROKE} />
                </TouchableOpacity>
              ) : null}
            </View>
          )
        })}
        </>
      )}

      <KeyboardFormModal visible={Boolean(editRow)} onClose={() => setEditRow(null)}>
        <Text style={styles.modalTitle}>Qty & price</Text>
        {editRow ? <Text style={styles.modalSub}>{editRow.name}</Text> : null}
        <TextInput
          style={styles.input}
          placeholder="Qty"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={editQty}
          onChangeText={setEditQty}
        />
        <TextInput
          style={styles.input}
          placeholder={`Unit price (${currency})`}
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={editPrice}
          onChangeText={setEditPrice}
          keyboardType="decimal-pad"
        />
        <TouchableOpacity
          style={[styles.addBtn, editBusy && styles.dim]}
          onPress={() => void savePrice()}
          disabled={editBusy}
        >
          <Text style={styles.addBtnText}>{editBusy ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </KeyboardFormModal>
    </View>
  )
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 24, alignItems: 'center' },
  lead: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18, marginBottom: 14 },
  addCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    padding: 12,
    gap: 8,
    marginBottom: 16,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#0a0a0a',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  addBtn: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingVertical: 10,
  },
  addBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 13 },
  dim: { opacity: 0.55 },
  empty: { color: 'rgba(255,255,255,0.38)', fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  checkBtn: { paddingTop: 2 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  rowText: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  rowTitleDone: { textDecorationLine: 'line-through', color: 'rgba(255,255,255,0.4)' },
  qty: { color: '#FFDC00', fontWeight: '700' },
  rowNotes: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 4, lineHeight: 16 },
  periodBanner: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.22)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  periodKicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  periodText: { color: '#FFDC00', fontSize: 14, fontWeight: '700' },
  periodRow: { color: '#FFDC00', fontSize: 12, fontWeight: '600', marginTop: 4 },
  deleteBtn: { padding: 4 },
  assigneeBlock: { gap: 8 },
  assigneeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#0f0f0f',
    maxWidth: '100%',
  },
  chipOn: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  chipText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: '#0a0a0a' },
  assigneeLine: { color: '#FFDC00', fontSize: 12, fontWeight: '700', marginTop: 4 },
  assigneeLineMuted: { color: 'rgba(255,220,0,0.45)', fontSize: 12, fontWeight: '700', marginTop: 4 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 4 },
  modalSub: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 14 },
  rowInputs: { flexDirection: 'row', gap: 8 },
  inputFlex: { flex: 1, marginBottom: 0 },
  pdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.4)',
    backgroundColor: 'rgba(255,220,0,0.1)',
    paddingVertical: 10,
  },
  pdfBtnText: { color: '#FFDC00', fontWeight: '800', fontSize: 13 },
  pdfHint: { fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 16 },
})
