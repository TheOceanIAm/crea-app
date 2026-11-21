import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { fetchCreaApi } from '@/lib/creaApiFetch'
import { normalizeCallSheet, serializeCallSheet, type CallSheetDocument } from '@/lib/callSheet'
import { callSheetShootLocationsEnabled } from '@/lib/callSheetLocations'
import {
  IMPORT_BUCKET,
  IMPORT_COLUMN_OPTIONS,
  IMPORT_MAX_BYTES,
  callSheetImportObjectPath,
  mergeImportedCallSheet,
  previewCallSheetImport,
  type CallSheetImportPreview,
  type ImportColumn,
  type ImportSection,
  type ImportedCallSheet,
  type KnownAccount,
  type ProjectCrewRef,
  type SheetChoice,
} from '@/lib/import/call-sheet'
import { supabase } from '@/lib/supabase'

const SESSION = 'Your session expired. Please log in again, your changes are still here.'

const SECTIONS: { id: ImportSection; label: string }[] = [
  { id: 'scenes', label: 'Scenes' },
  { id: 'locations', label: 'Locations' },
  { id: 'cast', label: 'Cast' },
  { id: 'crew', label: 'Crew' },
  { id: 'extras', label: 'Extras' },
  { id: 'day', label: 'Day' },
  { id: 'ignore', label: 'Ignore' },
]

function choicesOf(preview: CallSheetImportPreview): Record<string, SheetChoice> {
  return Object.fromEntries(
    preview.plans.map((plan) => [plan.name, { section: plan.section, columns: plan.columns, headerRow: plan.headerRow }])
  )
}

export function CallSheetImport({
  projectId,
  userId,
  shootDay,
  dayId,
  getCurrent,
  onSaved,
}: {
  projectId: string
  userId: string
  shootDay: string
  dayId: string
  getCurrent: () => { document: CallSheetDocument; wrapTime: string; notes: string }
  onSaved: (callSheet: unknown, wrapTime: string, notes: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<CallSheetImportPreview | null>(null)
  const [crew, setCrew] = useState<ProjectCrewRef[]>([])
  const [accounts, setAccounts] = useState<KnownAccount[]>([])
  if (!callSheetShootLocationsEnabled()) return null

  const rebuild = (next: CallSheetImportPreview, choices: Record<string, SheetChoice>) => {
    setPreview(
      previewCallSheetImport({
        fileName: next.fileName,
        sheets: next.sheets,
        shootDay,
        choices,
        projectCrew: crew,
        knownAccounts: accounts,
      })
    )
  }

  const pick = async () => {
    if (busy) return
    let DP: typeof import('expo-document-picker')
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      DP = require('expo-document-picker') as typeof import('expo-document-picker')
    } catch {
      Alert.alert('Import', 'This install cannot pick documents yet.')
      return
    }
    const picked = await DP.getDocumentAsync({
      type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/plain'],
      copyToCacheDirectory: true,
    })
    if (picked.canceled || !picked.assets?.[0]) return
    const asset = picked.assets[0]
    const name = asset.name || 'call-sheet.xlsx'
    if (name.toLowerCase().endsWith('.xls') && !name.toLowerCase().endsWith('.xlsx')) {
      Alert.alert('Import', 'Please save the file as .xlsx and upload again.')
      return
    }
    if (asset.size && asset.size > IMPORT_MAX_BYTES) {
      Alert.alert('Import', 'This file is larger than 10 MB.')
      return
    }
    const path = callSheetImportObjectPath(projectId, userId, name)
    if (typeof path !== 'string') {
      Alert.alert('Import', path.error)
      return
    }
    setBusy(true)
    try {
      const file = await fetch(asset.uri).then((res) => res.blob())
      const signed = await supabase.storage.from(IMPORT_BUCKET).createSignedUploadUrl(path)
      if (signed.error || !signed.data) {
        Alert.alert('Import', signed.error?.message || 'Import storage is not ready yet.')
        return
      }
      const sent = await supabase.storage.from(IMPORT_BUCKET).uploadToSignedUrl(signed.data.path, signed.data.token, file)
      if (sent.error) {
        Alert.alert('Import', sent.error.message)
        return
      }
      const { data, error, status } = await fetchCreaApi<{
        preview: CallSheetImportPreview
        projectCrew?: ProjectCrewRef[]
        knownAccounts?: KnownAccount[]
      }>(`/api/projects/${projectId}/call-sheet/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, shootDay, fileName: name }),
      })
      if (status === 401) {
        Alert.alert('Call sheet', SESSION)
        return
      }
      if (error || !data?.preview) {
        Alert.alert('Import', error || 'Could not read that file.')
        return
      }
      setCrew(data.projectCrew ?? [])
      setAccounts(data.knownAccounts ?? [])
      setPreview(data.preview)
    } catch {
      Alert.alert('Import', 'Could not read that file.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (mode: 'replace' | 'add') => {
    if (!preview || busy) return
    setBusy(true)
    try {
      const current = getCurrent()
      const merged = mergeImportedCallSheet(
        current.document as ImportedCallSheet,
        preview.document,
        mode,
        current.wrapTime,
        current.notes,
        preview.wrapTime,
        preview.notes
      )
      const people = { ...merged.document.people }
      for (const person of preview.people) {
        if (person.match === 'project') continue
        const added = await supabase
          .from('project_manual_crew')
          .insert({
            project_id: projectId,
            name: person.name,
            member_role: person.role || 'crew',
            email: person.email || null,
            phone: person.phone || null,
            created_by: userId,
          })
          .select('id')
          .single()
        if (added.error || !added.data?.id) {
          Alert.alert('Import', added.error?.message || 'Could not add that person to the crew list.')
          return
        }
        const nextKey = `manual:${added.data.id}`
        if (people[person.key]) {
          people[nextKey] = people[person.key]
          if (nextKey !== person.key) delete people[person.key]
        }
      }
      const document = serializeCallSheet(normalizeCallSheet({ ...merged.document, people }))
      const wrap = merged.wrapTime.trim()
      const { data, error, status } = await fetchCreaApi<{ ok: true; call_sheet: unknown }>(
        `/api/projects/${projectId}/production-days/${dayId}/call-sheet`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ call_sheet: document, notes: merged.notes, wrap_time: wrap || null }),
        }
      )
      if (status === 401) {
        Alert.alert('Call sheet', SESSION)
        return
      }
      if (error || !data?.call_sheet) {
        Alert.alert('Import', error || 'Could not save the call sheet.')
        return
      }
      onSaved(data.call_sheet, wrap, merged.notes)
      const c = preview.counts
      setPreview(null)
      Alert.alert('Imported', `${c.scenes} scenes, ${c.cast} cast, ${c.crew} crew, ${c.extras} extras.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.box}>
      <TouchableOpacity style={styles.btn} onPress={() => void pick()} disabled={busy}>
        <Text style={styles.btnText}>{busy ? 'Reading…' : 'Import from Excel or PDF'}</Text>
      </TouchableOpacity>
      {preview ? (
        <View style={styles.preview}>
          <Text style={styles.meta}>
            {preview.counts.locations} locations, {preview.counts.scenes} scenes, {preview.counts.cast} cast, {preview.counts.crew} crew.
          </Text>
          {preview.dateDiffers ? (
            <Text style={styles.warn}>The file date is {preview.fileDate}. This import stays on the selected day.</Text>
          ) : null}
          {preview.warnings.map((warning) => (
            <Text key={warning} style={styles.meta}>{warning}</Text>
          ))}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {preview.plans.map((plan) => (
                <View key={plan.name} style={styles.plan}>
                  <Text style={styles.meta}>{plan.name}</Text>
                  <View style={styles.row}>
                    {SECTIONS.map((section) => (
                      <TouchableOpacity
                        key={section.id}
                        style={[styles.chip, plan.section === section.id && styles.chipOn]}
                        onPress={() => {
                          const choices = choicesOf(preview)
                          choices[plan.name] = { ...choices[plan.name], section: section.id }
                          rebuild(preview, choices)
                        }}
                      >
                        <Text style={[styles.chipText, plan.section === section.id && styles.chipTextOn]}>{section.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {plan.headers.map((header, index) => (
                    <View key={`${plan.name}-${index}`} style={styles.row}>
                      <Text style={styles.meta}>{header || `Column ${index + 1}`}</Text>
                      <ScrollView horizontal>
                        <View style={styles.row}>
                          {IMPORT_COLUMN_OPTIONS.map((option) => (
                            <TouchableOpacity
                              key={option.id}
                              style={[styles.chip, (plan.columns[index] ?? 'ignore') === option.id && styles.chipOn]}
                              onPress={() => {
                                const choices = choicesOf(preview)
                                const columns = [...(choices[plan.name]?.columns ?? [])]
                                columns[index] = option.id as ImportColumn
                                choices[plan.name] = { ...choices[plan.name], columns }
                                rebuild(preview, choices)
                              }}
                            >
                              <Text style={[styles.chipText, (plan.columns[index] ?? 'ignore') === option.id && styles.chipTextOn]}>{option.label}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
          <TouchableOpacity style={styles.btn} onPress={() => void confirm('replace')} disabled={busy}>
            <Text style={styles.btnText}>Replace current call sheet</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => void confirm('add')} disabled={busy}>
            <Text style={styles.secondaryText}>Add to current call sheet</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 10, marginTop: 12 },
  btn: { backgroundColor: '#FFDC00', borderRadius: 999, paddingVertical: 12, paddingHorizontal: 16 },
  btnText: { color: '#0a0a0a', fontWeight: '700', textAlign: 'center' },
  secondary: { borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 16 },
  secondaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  preview: { gap: 8 },
  plan: { gap: 6, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: { borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  chipOn: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  chipText: { color: '#fff', fontSize: 11 },
  chipTextOn: { color: '#0a0a0a' },
  meta: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  warn: { color: '#FFDC00', fontSize: 12 },
})
