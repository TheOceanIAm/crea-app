import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Plus, Upload } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { supabase } from '@/lib/supabase'
import {
  appendRows,
  columnsMatch,
  emptyRow,
  nextSheetStatus,
  parseShotFile,
  sheetFromParsed,
  shotGlance,
  shotSheetFromDb,
  shotSheetKey,
  splitShotColumns,
  type ShotSheet,
  type ShotSheetStatus,
} from '@/lib/shotSheet'

const STATUS_LABEL: Record<ShotSheetStatus, string> = {
  open: 'Open',
  rolling: 'Rolling',
  done: 'Done',
  pick: 'Pick',
}

function base64ToBytes(b64: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = alphabet.indexOf(clean[i] ?? "A");
    const b = alphabet.indexOf(clean[i + 1] ?? "A");
    const c = alphabet.indexOf(clean[i + 2] ?? "A");
    const d = alphabet.indexOf(clean[i + 3] ?? "A");
    out.push((a << 2) | (b >> 4));
    if (i + 2 < clean.length) out.push(((b & 15) << 4) | (c >> 2));
    if (i + 3 < clean.length) out.push(((c & 3) << 6) | d);
  }
  return Uint8Array.from(out);
}

async function readStored(projectId: string, shootDay: string): Promise<ShotSheet | null> {
  try {
    const raw = await AsyncStorage.getItem(shotSheetKey(projectId, shootDay))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ShotSheet
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null
    return parsed
  } catch {
    return null
  }
}

export function FlexibleShotList({
  projectId,
  shootDay,
  readOnly,
  children,
}: {
  projectId: string
  shootDay: string
  readOnly?: boolean
  children: ReactNode
}) {
  const [sheet, setSheet] = useState<ShotSheet | null>(null)
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState<ShotSheet | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const latest = useRef<ShotSheet | null>(null)
  const seenUpdatedAt = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushing = useRef(false)
  const queued = useRef(false)
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  const cache = useCallback(
    (next: ShotSheet | null) => {
      const key = shotSheetKey(projectId, shootDay)
      if (next) void AsyncStorage.setItem(key, JSON.stringify(next))
      else void AsyncStorage.removeItem(key)
    },
    [projectId, shootDay]
  )

  const persist = useCallback(
    async (next: ShotSheet | null) => {
      if (next) {
        const { data, error } = await supabase
          .from('production_shot_sheets')
          .upsert(
            {
              project_id: projectId,
              shoot_date: shootDay,
              columns: next.columns,
              rows: next.rows,
              source_name: next.sourceName,
            },
            { onConflict: 'project_id,shoot_date' }
          )
          .select('updated_at')
          .maybeSingle()
        if (error) {
          Alert.alert('Shot list', 'Could not save this shot list to the project.')
          return
        }
        cache(next)
        const stamp = typeof data?.updated_at === 'string' ? data.updated_at : ''
        if (stamp > seenUpdatedAt.current) seenUpdatedAt.current = stamp
        return
      }
      const { error } = await supabase
        .from('production_shot_sheets')
        .delete()
        .eq('project_id', projectId)
        .eq('shoot_date', shootDay)
      if (error) {
        Alert.alert('Shot list', 'Could not switch back to the standard list.')
        return
      }
      cache(null)
    },
    [cache, projectId, shootDay]
  )

  const flush = useCallback(() => {
    if (flushing.current) {
      queued.current = true
      return
    }
    flushing.current = true
    queued.current = false
    const snapshot = latest.current
    void persist(snapshot).finally(() => {
      flushing.current = false
      if (queued.current) flush()
    })
  }, [persist])

  const save = useCallback(
    (next: ShotSheet | null, immediate = false) => {
      if (readOnlyRef.current) return
      latest.current = next
      setSheet(next)
      if (timer.current) clearTimeout(timer.current)
      if (immediate) {
        timer.current = null
        flush()
        return
      }
      timer.current = setTimeout(() => {
        timer.current = null
        flush()
      }, 450)
    },
    [flush]
  )

  useEffect(() => {
    let cancelled = false
    setReady(false)
    const apply = (next: ShotSheet | null, stamp = '') => {
      if (cancelled) return
      if (stamp > seenUpdatedAt.current) seenUpdatedAt.current = stamp
      latest.current = next
      setSheet(next)
      setReady(true)
    }
    const load = async () => {
      const { data, error } = await supabase
        .from('production_shot_sheets')
        .select('columns, rows, source_name, updated_at')
        .eq('project_id', projectId)
        .eq('shoot_date', shootDay)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        apply(await readStored(projectId, shootDay))
        return
      }
      const remote = data ? shotSheetFromDb(data) : null
      if (remote) {
        cache(remote)
        apply(remote, typeof data?.updated_at === 'string' ? data.updated_at : '')
        return
      }
      const local = await readStored(projectId, shootDay)
      apply(local)
      if (local && !readOnlyRef.current) void persist(local)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [cache, persist, projectId, shootDay])

  useEffect(() => {
    const channel = supabase
      .channel(`shot-sheet-${projectId}-${shootDay}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'production_shot_sheets',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          if (flushing.current || queued.current || timer.current) return
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { shoot_date?: string }
            if (oldRow.shoot_date && oldRow.shoot_date !== shootDay) return
            latest.current = null
            setSheet(null)
            cache(null)
            return
          }
          const row = payload.new as {
            shoot_date?: string
            updated_at?: string
            columns?: unknown
            rows?: unknown
            source_name?: unknown
          }
          if (row.shoot_date !== shootDay) return
          const stamp = row.updated_at ?? ''
          if (stamp && stamp <= seenUpdatedAt.current) return
          const parsed = shotSheetFromDb(row)
          if (!parsed) return
          if (stamp) seenUpdatedAt.current = stamp
          latest.current = parsed
          setSheet(parsed)
          cache(parsed)
        }
      )
      .subscribe()
    return () => {
      if (timer.current) clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [cache, projectId, shootDay])

  const pickFile = async () => {
    if (readOnly || busy) return
    let DP: typeof import('expo-document-picker')
    let FileSystem: typeof import('expo-file-system')
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      DP = require('expo-document-picker') as typeof import('expo-document-picker')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      FileSystem = require('expo-file-system') as typeof import('expo-file-system')
    } catch {
      Alert.alert('Upload', 'This install cannot pick documents yet.')
      return
    }
    const picked = await DP.getDocumentAsync({
      type: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'text/comma-separated-values',
        'public.comma-separated-values-text',
      ],
      copyToCacheDirectory: true,
    })
    if (picked.canceled || !picked.assets?.[0]) return
    const asset = picked.assets[0]
    const name = asset.name || 'shot-list.xlsx'
    setBusy(true)
    try {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })
      const parsed = parseShotFile(name, base64ToBytes(b64))
      if ('error' in parsed) {
        Alert.alert('Shot list', parsed.error)
        return
      }
      setTruncated(parsed.truncated)
      setPending(sheetFromParsed(parsed, name))
    } catch {
      Alert.alert('Shot list', 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  const useSheet = (mode: 'replace' | 'append') => {
    if (!pending) return
    if (mode === 'append' && sheet) {
      const merged = appendRows(sheet, pending)
      if ('error' in merged) {
        Alert.alert('Shot list', merged.error)
        return
      }
      save(merged, true)
    } else {
      save(pending, true)
    }
    setPending(null)
  }

  const done = sheet?.rows.filter((row) => row.status === 'done' || row.status === 'pick').length ?? 0
  const total = sheet?.rows.length ?? 0
  const sameColumns = Boolean(sheet && pending && columnsMatch(sheet.columns, pending.columns))

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  return (
    <View>
      {readOnly ? null : (
        <TouchableOpacity style={styles.uploadBtn} onPress={() => void pickFile()} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFDC00" /> : <Upload size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />}
          <Text style={styles.uploadText}>{busy ? 'Reading…' : 'Upload Excel or PDF'}</Text>
        </TouchableOpacity>
      )}
      <Text style={styles.hint}>
        {sheet
          ? `Columns from ${sheet.sourceName}. Saved in this project, so the website and the app show the same list.`
          : 'Add shots by hand, or upload an Excel file or PDF. The columns from the file become the list for this day.'}
      </Text>
      {sheet ? (
        <TouchableOpacity onPress={() => save(null, true)}>
          <Text style={styles.standardLink}>Standard list</Text>
        </TouchableOpacity>
      ) : null}

      {sheet ? (
        <View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${total ? Math.round((done / total) * 100) : 0}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {done} / {total} done
          </Text>
          {sheet.rows.map((row) => {
            const layout = splitShotColumns(sheet.columns, sheet.rows)
            const open = openId === row.id
            const preview = layout.story.map((index) => (row.cells[index] ?? '').trim()).find(Boolean)
            const glance = shotGlance(sheet.columns, row.cells)
            return (
              <View key={row.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <TouchableOpacity
                    style={styles.summary}
                    onPress={() => setOpenId(open ? null : row.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.summaryFacts}>
                      <Text style={styles.summaryLabel}>{glance.label} </Text>
                      {glance.value}
                    </Text>
                    {glance.facts ? (
                      <Text style={styles.summaryMeta} numberOfLines={1}>
                        {glance.facts}
                      </Text>
                    ) : null}
                    {!open && preview ? (
                      <Text style={styles.summaryPreview} numberOfLines={2}>
                        {preview}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      style={styles.statusBtn}
                      disabled={readOnly}
                      onPress={() =>
                        save(
                          {
                            ...sheet,
                            rows: sheet.rows.map((item) =>
                              item.id === row.id ? { ...item, status: nextSheetStatus(item.status) } : item
                            ),
                          },
                          true
                        )
                      }
                    >
                      <Text style={styles.statusText}>{STATUS_LABEL[row.status]}</Text>
                    </TouchableOpacity>
                    {readOnly ? null : (
                      <TouchableOpacity
                        onPress={() => save({ ...sheet, rows: sheet.rows.filter((item) => item.id !== row.id) }, true)}
                        hitSlop={8}
                      >
                        <Text style={styles.deleteText}>✕</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => setOpenId(open ? null : row.id)} hitSlop={8}>
                      <Text style={[styles.chevron, open && styles.chevronOpen]}>▼</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {open ? (
                  <View style={styles.expanded}>
                    <View style={styles.compactWrap}>
                      {layout.compact.map((index) => (
                        <View key={`${row.id}-${sheet.columns[index]}`} style={styles.compactField}>
                          <Text style={styles.compactLabel}>{sheet.columns[index]}</Text>
                          <TextInput
                            style={styles.compactInput}
                            value={row.cells[index] ?? ''}
                            editable={!readOnly}
                            onChangeText={(value) => {
                              const cells = row.cells.map((cell, i) => (i === index ? value : cell))
                              save({
                                ...sheet,
                                rows: sheet.rows.map((item) => (item.id === row.id ? { ...item, cells } : item)),
                              })
                            }}
                            placeholderTextColor="rgba(255,255,255,0.25)"
                          />
                        </View>
                      ))}
                    </View>
                    {layout.story.map((index) => (
                      <View key={`${row.id}-story-${index}`}>
                        <Text style={styles.storyLabel}>{sheet.columns[index]}</Text>
                        <TextInput
                          style={styles.storyInput}
                          value={row.cells[index] ?? ''}
                          editable={!readOnly}
                          multiline
                          textAlignVertical="top"
                          onChangeText={(value) => {
                            const cells = row.cells.map((cell, i) => (i === index ? value : cell))
                            save({
                              ...sheet,
                              rows: sheet.rows.map((item) => (item.id === row.id ? { ...item, cells } : item)),
                            })
                          }}
                          placeholderTextColor="rgba(255,255,255,0.25)"
                        />
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )
          })}
          {readOnly ? null : (
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => save({ ...sheet, rows: [...sheet.rows, emptyRow(sheet.columns)] }, true)}
            >
              <Plus size={18} color="#0a0a0a" strokeWidth={ICON_STROKE} />
              <Text style={styles.addBtnText}>New row</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        children
      )}

      <Modal visible={Boolean(pending)} transparent animationType="fade" onRequestClose={() => setPending(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPending(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>{pending?.sourceName}</Text>
            <Text style={styles.modalMeta}>
              {pending?.columns.length ?? 0} columns · {pending?.rows.length ?? 0} shots
              {truncated ? ' · trimmed to the first rows and columns' : ''}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
              {pending?.columns.map((column) => (
                <View key={column} style={styles.chip}>
                  <Text style={styles.chipText}>{column}</Text>
                </View>
              ))}
            </ScrollView>
            {pending?.rows.slice(0, 3).map((row) => {
              const preview = splitShotColumns(pending.columns, pending.rows)
              return (
                <View key={row.id} style={styles.previewCard}>
                  <Text style={styles.previewLine} numberOfLines={1}>
                    {preview.compact.map((index) => row.cells[index]).filter(Boolean).join(' · ')}
                  </Text>
                  {preview.story.map((index) => (
                    <Text key={index} style={styles.previewStory} numberOfLines={3}>
                      {pending.columns[index]}: {row.cells[index] || '—'}
                    </Text>
                  ))}
                </View>
              )
            })}
            <TouchableOpacity style={styles.primaryBtn} onPress={() => useSheet('replace')}>
              <Text style={styles.primaryBtnText}>Use for this day</Text>
            </TouchableOpacity>
            {sameColumns ? (
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => useSheet('append')}>
                <Text style={styles.secondaryBtnText}>Add these rows</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPending(null)}>
              <Text style={styles.secondaryBtnText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 24 },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.4)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 8,
  },
  uploadText: { color: '#FFDC00', fontWeight: '800', fontSize: 13 },
  hint: { color: 'rgba(255,255,255,0.4)', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  standardLink: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', marginBottom: 12 },
  progressTrack: { height: 8, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: 'rgba(255,220,0,0.8)' },
  progressLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 6, marginBottom: 12 },
  card: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 12,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  summary: { flex: 1 },
  summaryFacts: { color: '#fff', fontSize: 15, fontWeight: '700', lineHeight: 20 },
  summaryLabel: { color: '#FFDC00', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  summaryMeta: { color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 2 },
  summaryPreview: { color: 'rgba(255,255,255,0.82)', fontSize: 14, lineHeight: 20, marginTop: 6 },
  chevron: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  expanded: { gap: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 10 },
  compactWrap: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  compactField: { width: '46%' },
  compactLabel: { color: '#FFDC00', fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  compactInput: { color: '#fff', fontSize: 15, paddingVertical: 2 },
  cardActions: { alignItems: 'flex-end', gap: 8 },
  storyLabel: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  storyInput: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    lineHeight: 22,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 72,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6 },
  headerCell: {
    width: 140,
    color: '#FFDC00',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 6,
  },
  headerStatus: { width: 88, color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  dataRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  cell: {
    width: 140,
    color: '#fff',
    fontSize: 14,
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  statusBtn: {
    width: 88,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 6,
    alignItems: 'center',
  },
  statusText: { color: '#FFDC00', fontSize: 11, fontWeight: '800' },
  deleteText: { color: 'rgba(255,255,255,0.35)', paddingHorizontal: 8, fontSize: 14 },
  addBtn: {
    marginTop: 14,
    backgroundColor: '#FFDC00',
    borderRadius: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  addBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: { backgroundColor: '#161616', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', padding: 18 },
  modalTitle: { color: '#FFDC00', fontSize: 22, fontWeight: '800' },
  modalMeta: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4, marginBottom: 12 },
  chips: { marginBottom: 12 },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
  },
  chipText: { color: '#FFDC00', fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  previewCard: { marginBottom: 10 },
  previewLine: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 4 },
  previewStory: { color: 'rgba(255,255,255,0.9)', fontSize: 14, lineHeight: 20 },
  primaryBtn: { marginTop: 14, backgroundColor: '#FFDC00', borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#0a0a0a', fontWeight: '800' },
  secondaryBtn: {
    marginTop: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: 'rgba(255,255,255,0.75)', fontWeight: '700' },
})
