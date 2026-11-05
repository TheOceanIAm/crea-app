import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { decode } from 'base64-arraybuffer'
import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { fetchCreaApi } from '@/lib/creaApiFetch'
import { supabase } from '@/lib/supabase'
import {
  BUDGET_RECEIPT_BUCKET,
  type BudgetLineSpendDraft,
  type BudgetReceiptRow,
  parseReceiptAmount,
} from '@/lib/budgetReceiptLines'
import { formatMoneyAmount } from '@/lib/projectInternalBudget'

const PRESETS = ['Food & beverage', 'Travel', 'Rental cars', 'Other']

type Props = {
  projectId: string
  currency: string
  lines: BudgetLineSpendDraft[]
  disabled?: boolean
  onApplied: (input: { lineId: string; label: string; spent: number }) => void
  onReceipts: (receipts: BudgetReceiptRow[]) => void
}

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function asReceipt(row: Record<string, unknown>): BudgetReceiptRow {
  return {
    id: String(row.id),
    budget_line_id: typeof row.budget_line_id === 'string' ? row.budget_line_id : null,
    label: String(row.label ?? ''),
    amount: Number(row.amount) || 0,
    currency: String(row.currency ?? 'EUR'),
    vendor: typeof row.vendor === 'string' && row.vendor.trim() ? row.vendor : null,
    storage_path: typeof row.storage_path === 'string' && row.storage_path.trim() ? row.storage_path : null,
    created_at: String(row.created_at ?? ''),
  }
}

export function BudgetReceiptsPanel({ projectId, currency, lines, disabled, onApplied, onReceipts }: Props) {
  const [receipts, setReceipts] = useState<BudgetReceiptRow[]>([])
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [vendor, setVendor] = useState('')
  const [category, setCategory] = useState(PRESETS[0])
  const [photo, setPhoto] = useState<{ base64: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState<string | null>(null)
  const readGeneration = useRef(0)
  const onReceiptsRef = useRef(onReceipts)
  onReceiptsRef.current = onReceipts

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const label of [...PRESETS, ...lines.map((line) => line.label.trim())]) {
      const key = label.toLowerCase()
      if (!label || seen.has(key)) continue
      seen.add(key)
      out.push(label)
    }
    return out
  }, [lines])

  const loadReceipts = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_budget_receipts')
      .select('id, budget_line_id, label, amount, currency, vendor, storage_path, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      setReceipts([])
      onReceiptsRef.current([])
      return
    }
    const next = ((data ?? []) as Record<string, unknown>[]).map(asReceipt)
    setReceipts(next)
    onReceiptsRef.current(next)
  }, [projectId])

  useEffect(() => {
    void loadReceipts()
  }, [loadReceipts])

  const pickPhoto = async (source: 'camera' | 'library') => {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Receipt', source === 'camera' ? 'Allow camera access to photograph the receipt.' : 'Allow photo access to attach the receipt.')
      return
    }
    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, base64: true })
    if (picked.canceled || !picked.assets?.[0]) return
    const asset = picked.assets[0]
    const base64 =
      asset.base64 ??
      (asset.uri
        ? await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })
        : null)
    if (!base64) {
      Alert.alert('Receipt', 'Could not read that photo.')
      return
    }
    setPhoto({ base64 })
    setReadNote(null)
    const generation = readGeneration.current + 1
    readGeneration.current = generation
    const amountBeforeRead = amount
    setReading(true)
    const { data, error } = await fetchCreaApi<{ ok?: boolean; amount?: number; error?: string }>(
      '/api/app/budget/read-receipt',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          imageBase64: base64,
          mediaType: 'image/jpeg',
        }),
        timeoutMs: 45_000,
      },
    )
    if (readGeneration.current !== generation) return
    setReading(false)
    const total = typeof data?.amount === 'number' ? data.amount : null
    if (total != null && total > 0) {
      setAmount((current) => (current === amountBeforeRead ? total.toFixed(2) : current))
      setReadNote(null)
      return
    }
    setReadNote(
      error === 'timeout'
        ? 'Reading the total took too long. Type the amount.'
        : error && error !== 'network_error' && error !== 'missing_web_url' && error !== 'no_session'
          ? error
          : 'Could not read the total. Type the amount.',
    )
  }

  const saveReceipt = async () => {
    if (disabled || saving) return
    const parsed = parseReceiptAmount(amount)
    if (parsed == null) {
      Alert.alert('Receipt', 'Enter the amount from the receipt.')
      return
    }
    const label = category.trim()
    if (!label) {
      Alert.alert('Receipt', 'Choose a category.')
      return
    }
    setSaving(true)
    let path: string | null = null
    try {
      if (photo) {
        path = `${projectId}/${newId()}.jpg`
        const uploaded = await supabase.storage.from(BUDGET_RECEIPT_BUCKET).upload(path, decode(photo.base64), {
          contentType: 'image/jpeg',
          upsert: false,
        })
        if (uploaded.error) throw uploaded.error
      }
      const { data, error } = await supabase.rpc('crea_add_budget_receipt', {
        p_project_id: projectId,
        p_label: label,
        p_amount: parsed,
        p_currency: currency,
        p_vendor: vendor.trim(),
        p_storage_path: path,
      })
      if (error) throw error
      const payload = (data ?? {}) as { budget_line_id?: string; label?: string; spent_amount?: number | string }
      const spent = Number(payload.spent_amount)
      if (payload.budget_line_id && Number.isFinite(spent)) {
        onApplied({ lineId: payload.budget_line_id, label: payload.label || label, spent })
      }
      setAmount('')
      setVendor('')
      setPhoto(null)
      setOpen(false)
      await loadReceipts()
    } catch (error) {
      if (path) await supabase.storage.from(BUDGET_RECEIPT_BUCKET).remove([path])
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Could not file that receipt.'
      Alert.alert('Receipt', message)
    } finally {
      setSaving(false)
    }
  }

  const openFile = async (storagePath: string) => {
    const { data, error } = await supabase.storage.from(BUDGET_RECEIPT_BUCKET).createSignedUrl(storagePath, 60 * 10)
    if (error || !data?.signedUrl) {
      Alert.alert('Receipt', 'Could not open that file.')
      return
    }
    await Linking.openURL(data.signedUrl)
  }

  const removeReceipt = (receipt: BudgetReceiptRow) => {
    Alert.alert('Remove receipt', 'This subtracts the amount from Actual.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const { data, error } = await supabase.rpc('crea_delete_budget_receipt', { p_receipt_id: receipt.id })
            if (error) {
              Alert.alert('Receipt', error.message)
              return
            }
            const payload = (data ?? {}) as {
              budget_line_id?: string | null
              spent_amount?: number | string | null
              storage_path?: string | null
            }
            if (payload.budget_line_id && payload.spent_amount != null && Number.isFinite(Number(payload.spent_amount))) {
              onApplied({
                lineId: payload.budget_line_id,
                label: receipt.label,
                spent: Number(payload.spent_amount),
              })
            }
            if (payload.storage_path) {
              await supabase.storage.from(BUDGET_RECEIPT_BUCKET).remove([payload.storage_path])
            }
            await loadReceipts()
          })()
        },
      },
    ])
  }

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.addBtn, (disabled || saving) && styles.dim]}
        onPress={() => setOpen((v) => !v)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Add receipt"
      >
        <Text style={styles.addBtnText}>{open ? 'Close' : '+Add Receipt'}</Text>
      </TouchableOpacity>
      {disabled ? <Text style={styles.hint}>Connect to the internet to add a receipt.</Text> : null}
      {open && !disabled ? (
        <View style={styles.form}>
          <Text style={styles.hint}>
            Photograph a receipt, tag the category, and confirm the amount. It is added to Actual for that category.
          </Text>
          <Text style={styles.fieldLabel}>Amount ({currency})</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="e.g. 42.50"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />
          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.chips}>
            {categories.map((label) => {
              const active = label.toLowerCase() === category.toLowerCase()
              return (
                <TouchableOpacity
                  key={label}
                  style={[styles.chip, active && styles.chipOn]}
                  onPress={() => setCategory(label)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text style={styles.fieldLabel}>Vendor (optional)</Text>
          <TextInput
            style={styles.input}
            value={vendor}
            onChangeText={setVendor}
            placeholder="e.g. Café set lunch"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />
          <View style={styles.photoRow}>
            <TouchableOpacity style={[styles.secondaryBtn, styles.photoBtn]} onPress={() => void pickPhoto('camera')}>
              <Text style={styles.secondaryBtnText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryBtn, styles.photoBtn]} onPress={() => void pickPhoto('library')}>
              <Text style={styles.secondaryBtnText}>Choose photo</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>
            {reading ? 'Reading the total…' : photo ? 'Photo attached.' : 'Photo is optional.'}
          </Text>
          {readNote ? <Text style={styles.hint}>{readNote}</Text> : null}
          <TouchableOpacity style={[styles.primaryBtn, saving && styles.dim]} onPress={() => void saveReceipt()} disabled={saving}>
            {saving ? <ActivityIndicator color="#0a0a0a" /> : <Text style={styles.primaryBtnText}>Add to budget</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
      {receipts.map((receipt) => (
        <View key={receipt.id} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{receipt.label}</Text>
            <Text style={styles.rowMeta}>
              {formatMoneyAmount(receipt.amount, receipt.currency || currency)}
              {receipt.vendor ? ` · ${receipt.vendor}` : ''}
            </Text>
          </View>
          {receipt.storage_path ? (
            <TouchableOpacity onPress={() => void openFile(receipt.storage_path!)}>
              <Text style={styles.link}>View</Text>
            </TouchableOpacity>
          ) : null}
          {!disabled ? (
            <TouchableOpacity onPress={() => removeReceipt(receipt)}>
              <Text style={styles.remove}>Remove</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  addBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  addBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14 },
  hint: { fontSize: 12, color: 'rgba(255,255,255,0.38)', marginBottom: 8, lineHeight: 17 },
  fieldLabel: { fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 4 },
  form: { marginBottom: 8 },
  input: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
    marginBottom: 10,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipOn: { borderColor: '#FFDC00', backgroundColor: 'rgba(255,220,0,0.12)' },
  chipText: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#FFDC00' },
  photoRow: { flexDirection: 'row', gap: 8 },
  primaryBtn: {
    backgroundColor: '#FFDC00',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14 },
  photoBtn: { flex: 1 },
  secondaryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryBtnText: { color: 'rgba(255,255,255,0.75)', fontWeight: '700', fontSize: 13 },
  dim: { opacity: 0.6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  rowText: { flex: 1 },
  rowTitle: { color: '#fff', fontWeight: '600', fontSize: 14 },
  rowMeta: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 },
  link: { color: '#FFDC00', fontWeight: '700', fontSize: 13 },
  remove: { color: '#ff6b6b', fontWeight: '700', fontSize: 13 },
})
