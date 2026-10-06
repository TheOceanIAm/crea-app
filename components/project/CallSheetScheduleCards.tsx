import { useState, type ReactNode } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ChevronDown } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import {
  EMPTY_CALL_SHEET_SCENE,
  personIsCast,
  type CallSheetBackgroundRow,
  type CallSheetPersonCell,
  type CallSheetSceneRow,
} from '@/lib/callSheet'

export type CallSheetAdvanceCard = {
  dateLabel: string
  dayLabel: string | null
  generalCall: string
  notes: string
  sceneCount: number
  filled: boolean
}

type Person = { key: string; name: string; roleLabel: string }

type Props = {
  editable: boolean
  people: Person[]
  cells: Record<string, CallSheetPersonCell>
  onChangePerson: (key: string, patch: Partial<CallSheetPersonCell>) => void
  scenes: CallSheetSceneRow[]
  onChangeScenes: (rows: CallSheetSceneRow[]) => void
  background: CallSheetBackgroundRow[]
  onChangeBackground: (rows: CallSheetBackgroundRow[]) => void
  advance: CallSheetAdvanceCard | null
  onOpenAdvance?: () => void
}

function Fold({
  title,
  preview,
  children,
}: {
  title: string
  preview: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <View style={styles.fold}>
      <TouchableOpacity style={styles.foldHead} onPress={() => setOpen((v) => !v)} activeOpacity={0.8}>
        <View style={styles.foldHeadText}>
          <Text style={styles.foldTitle}>{title}</Text>
          {!open ? (
            <Text style={styles.foldPreview} numberOfLines={1}>
              {preview}
            </Text>
          ) : null}
        </View>
        <ChevronDown
          size={18}
          color="rgba(255,255,255,0.4)"
          strokeWidth={ICON_STROKE}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>
      {open ? <View style={styles.foldBody}>{children}</View> : null}
    </View>
  )
}

function Line({
  label,
  value,
  placeholder,
  editable,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  editable: boolean
  onChange: (v: string) => void
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.25)"
        editable={editable}
        onChangeText={onChange}
      />
    </View>
  )
}

function sceneLine(row: CallSheetSceneRow) {
  return [row.scene || 'Scene', row.int_ext, row.description, row.cast && `Cast ${row.cast}`].filter(Boolean).join(' · ')
}

export function CallSheetScheduleCards({
  editable,
  people,
  cells,
  onChangePerson,
  scenes,
  onChangeScenes,
  background,
  onChangeBackground,
  advance,
  onOpenAdvance,
}: Props) {
  const castPeople = people.filter((p) => personIsCast(cells[p.key]))
  const available = people.filter((p) => !personIsCast(cells[p.key]))
  const scenePreviewText = scenes.length === 0 ? 'None yet' : scenes.map((row) => row.scene || 'Scene').slice(0, 4).join(', ')
  const castPreview = castPeople.length === 0 ? 'None yet' : `${castPeople.length} on the list`
  const bgCount = background.reduce((sum, row) => sum + (row.count ?? 0), 0)
  const bgPreview =
    background.length === 0 ? 'None yet' : `${bgCount || background.length} · ${background.map((r) => r.label).slice(0, 2).join(', ')}`
  const advancePreview = advance
    ? [advance.dateLabel, advance.generalCall && `Call ${advance.generalCall}`].filter(Boolean).join(' · ')
    : 'Last shoot day'

  const patchScene = (index: number, patch: Partial<CallSheetSceneRow>) => {
    onChangeScenes(scenes.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  const patchBg = (index: number, patch: Partial<CallSheetBackgroundRow>) => {
    onChangeBackground(background.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  return (
    <View style={styles.wrap}>
      <Fold title="Today's scenes" preview={scenePreviewText}>
        {scenes.map((row, index) => (
          <SceneCard
            key={`scene-${index}`}
            row={row}
            editable={editable}
            onChange={(patch) => patchScene(index, patch)}
            onRemove={() => onChangeScenes(scenes.filter((_, i) => i !== index))}
          />
        ))}
        {scenes.length === 0 ? (
          <Text style={styles.muted}>Scene, interior or exterior, cast numbers, location, and a move.</Text>
        ) : null}
        {editable ? (
          <TouchableOpacity style={styles.addBtn} onPress={() => onChangeScenes([...scenes, { ...EMPTY_CALL_SHEET_SCENE }])}>
            <Text style={styles.addBtnText}>Add scene</Text>
          </TouchableOpacity>
        ) : null}
      </Fold>

      <Fold title="Cast calls" preview={castPreview}>
        {castPeople.map((person) => (
          <CastCard
            key={person.key}
            name={person.name}
            roleLabel={person.roleLabel}
            cell={cells[person.key] ?? {}}
            editable={editable}
            onChange={(patch) => onChangePerson(person.key, patch)}
            onRemove={() => onChangePerson(person.key, { kind: 'crew' })}
          />
        ))}
        {editable && available.length > 0 ? (
          <View style={styles.chips}>
            {available.map((person) => (
              <TouchableOpacity
                key={person.key}
                style={styles.chip}
                onPress={() => onChangePerson(person.key, { kind: 'cast' })}
              >
                <Text style={styles.chipText}>+ {person.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {people.length === 0 ? <Text style={styles.muted}>Add crew above, then mark who is on the cast list.</Text> : null}
      </Fold>

      <Fold title="Extras & stand-ins" preview={bgPreview}>
        {background.map((row, index) => (
          <View key={`bg-${index}`} style={styles.card}>
            <View style={styles.grid}>
              <Line label="Who" value={row.label} placeholder="Office workers" editable={editable} onChange={(v) => patchBg(index, { label: v })} />
              <Line
                label="Qty"
                value={row.count ? String(row.count) : ''}
                placeholder="3"
                editable={editable}
                onChange={(v) => {
                  const n = Number(v)
                  patchBg(index, { count: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined })
                }}
              />
            </View>
            <View style={styles.grid}>
              <Line label="Arrive" value={row.in ?? ''} placeholder="4:00 PM" editable={editable} onChange={(v) => patchBg(index, { in: v })} />
              <Line label="Ready" value={row.ready ?? ''} placeholder="5:00 PM" editable={editable} onChange={(v) => patchBg(index, { ready: v })} />
            </View>
            {editable ? (
              <TouchableOpacity onPress={() => onChangeBackground(background.filter((_, i) => i !== index))}>
                <Text style={styles.remove}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {editable ? (
          <TouchableOpacity style={styles.addBtn} onPress={() => onChangeBackground([...background, { label: '' }])}>
            <Text style={styles.addBtnText}>Add extras</Text>
          </TouchableOpacity>
        ) : null}
      </Fold>

      <Fold title="Next shoot day" preview={advancePreview}>
        {advance ? (
          <View style={styles.card}>
            <Text style={styles.advanceTitle}>
              {advance.dateLabel}
              {advance.dayLabel ? ` · ${advance.dayLabel}` : ''}
            </Text>
            <Text style={styles.muted}>
              {advance.filled
                ? [advance.generalCall && `General call ${advance.generalCall}`, advance.sceneCount ? `${advance.sceneCount} scenes` : '', advance.notes]
                    .filter(Boolean)
                    .join(' · ') || 'Call sheet started.'
                : 'No call sheet for that day yet.'}
            </Text>
            {onOpenAdvance ? (
              <TouchableOpacity style={styles.addBtn} onPress={onOpenAdvance}>
                <Text style={styles.addBtnText}>Open that day</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <Text style={styles.muted}>This is the last shoot day in the project.</Text>
        )}
      </Fold>
    </View>
  )
}

function SceneCard({
  row,
  editable,
  onChange,
  onRemove,
}: {
  row: CallSheetSceneRow
  editable: boolean
  onChange: (patch: Partial<CallSheetSceneRow>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(!row.scene && !row.description)
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.rowHead} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {sceneLine(row) || 'Empty scene'}
        </Text>
        <ChevronDown size={16} color="rgba(255,255,255,0.35)" style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </TouchableOpacity>
      {open ? (
        <View style={styles.cardBody}>
          <View style={styles.grid}>
            <Line label="Scene" value={row.scene} placeholder="12" editable={editable} onChange={(v) => onChange({ scene: v })} />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>INT / EXT</Text>
              <View style={styles.intRow}>
                {['INT', 'EXT'].map((key) => (
                  <TouchableOpacity
                    key={key}
                    disabled={!editable}
                    onPress={() => onChange({ int_ext: row.int_ext === key ? '' : key })}
                    style={[styles.intBtn, row.int_ext === key && styles.intBtnOn]}
                  >
                    <Text style={[styles.intBtnText, row.int_ext === key && styles.intBtnTextOn]}>{key}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
          <Line label="What happens" value={row.description} placeholder="Jennie leaves for work" editable={editable} onChange={(v) => onChange({ description: v })} />
          <View style={styles.grid}>
            <Line label="Cast" value={row.cast} placeholder="3, 7" editable={editable} onChange={(v) => onChange({ cast: v })} />
            <Line label="Location" value={row.location} placeholder="Stage / address" editable={editable} onChange={(v) => onChange({ location: v })} />
          </View>
          <Line label="Move after" value={row.move} placeholder="Company move · 15 min" editable={editable} onChange={(v) => onChange({ move: v })} />
          {editable ? (
            <TouchableOpacity onPress={onRemove}>
              <Text style={styles.remove}>Remove scene</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function CastCard({
  name,
  roleLabel,
  cell,
  editable,
  onChange,
  onRemove,
}: {
  name: string
  roleLabel: string
  cell: CallSheetPersonCell
  editable: boolean
  onChange: (patch: Partial<CallSheetPersonCell>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const preview = [cell.cast_no ? `#${cell.cast_no}` : null, name, cell.character, cell.call_time].filter(Boolean).join(' · ')
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.rowHead} onPress={() => setOpen((v) => !v)}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {preview || name}
        </Text>
        <Text style={styles.role}>{roleLabel}</Text>
      </TouchableOpacity>
      {open ? (
        <View style={styles.cardBody}>
          <View style={styles.grid}>
            <Line
              label="#"
              value={cell.cast_no ? String(cell.cast_no) : ''}
              placeholder="5"
              editable={editable}
              onChange={(v) => {
                const n = Number(v)
                onChange({ cast_no: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined })
              }}
            />
            <Line label="Character" value={cell.character ?? ''} placeholder="Stacy" editable={editable} onChange={(v) => onChange({ character: v })} />
          </View>
          <View style={styles.grid}>
            <Line label="Call" value={cell.call_time ?? ''} placeholder="11:00" editable={editable} onChange={(v) => onChange({ call_time: v })} />
            <Line label="Set" value={cell.location ?? ''} placeholder="Basecamp / set" editable={editable} onChange={(v) => onChange({ location: v })} />
          </View>
          <TouchableOpacity onPress={() => setMore((v) => !v)}>
            <Text style={styles.more}>{more ? 'Hide HMU and notes' : 'HMU, wardrobe, notes'}</Text>
          </TouchableOpacity>
          {more ? (
            <View style={styles.grid}>
              <Line label="Status" value={cell.status ?? ''} placeholder="SW" editable={editable} onChange={(v) => onChange({ status: v })} />
              <Line label="Pickup" value={cell.report ?? ''} placeholder="Ride with James" editable={editable} onChange={(v) => onChange({ report: v })} />
              <Line label="HMU" value={cell.hmu ?? ''} placeholder="11:15" editable={editable} onChange={(v) => onChange({ hmu: v })} />
              <Line label="Wardrobe" value={cell.wardrobe ?? ''} placeholder="11:20" editable={editable} onChange={(v) => onChange({ wardrobe: v })} />
              <Line label="Ready" value={cell.ready ?? ''} placeholder="11:45" editable={editable} onChange={(v) => onChange({ ready: v })} />
              <Line label="Note" value={cell.remarks ?? ''} placeholder="Self drive" editable={editable} onChange={(v) => onChange({ remarks: v })} />
            </View>
          ) : null}
          {editable ? (
            <TouchableOpacity onPress={onRemove}>
              <Text style={styles.remove}>Remove from cast</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginBottom: 10 },
  fold: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  foldHeadText: { flex: 1, minWidth: 0 },
  foldTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' },
  foldPreview: { marginTop: 4, fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.75)' },
  foldBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  card: { backgroundColor: '#0a0a0a', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 10, gap: 8 },
  cardBody: { gap: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { flex: 1, color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
  role: { color: 'rgba(255,255,255,0.35)', fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  field: { flexGrow: 1, minWidth: '46%', gap: 4 },
  fieldLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  intRow: { flexDirection: 'row', gap: 6 },
  intBtn: { flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  intBtnOn: { backgroundColor: '#FFDC00', borderColor: '#FFDC00' },
  intBtnText: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '800' },
  intBtnTextOn: { color: '#0a0a0a' },
  addBtn: { alignSelf: 'flex-start', backgroundColor: '#FFDC00', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { color: '#0a0a0a', fontWeight: '800', fontSize: 13 },
  remove: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '700' },
  more: { color: 'rgba(255,220,0,0.85)', fontSize: 12, fontWeight: '800' },
  muted: { color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700' },
  advanceTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
})
