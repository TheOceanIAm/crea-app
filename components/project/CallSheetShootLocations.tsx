import { Alert, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import {
  CALL_SHEET_LOCATION_ADDRESS_LIMIT,
  CALL_SHEET_LOCATION_NAME_LIMIT,
  CALL_SHEET_LOCATION_NOTES_LIMIT,
  type CallSheetLocation,
  type CallSheetSceneRow,
} from '@/lib/callSheet'
import {
  CALL_SHEET_LOCATION_LIMIT_HINT,
  callSheetMapsUrl,
  callSheetShootLocationsEnabled,
  canAddCallSheetLocation,
  clipCallSheetLocationFields,
  newCallSheetLocationId,
  moveCallSheetLocation,
  scenesUsingCallSheetLocation,
  unlinkCallSheetLocation,
} from '@/lib/callSheetLocations'

type Props = {
  locations: CallSheetLocation[]
  scenes: CallSheetSceneRow[]
  editable: boolean
  onChangeLocations: (rows: CallSheetLocation[]) => void
  onChangeScenes: (rows: CallSheetSceneRow[]) => void
}

function patchLocation(
  rows: CallSheetLocation[],
  index: number,
  patch: { name?: string; address?: string; notes?: string },
) {
  return rows.map((row, i) => {
    if (i !== index) return row
    const next = clipCallSheetLocationFields({
      name: patch.name ?? row.name,
      address: patch.address ?? row.address,
      notes: patch.notes ?? row.notes ?? '',
    })
    const location: CallSheetLocation = { id: row.id, name: next.name, address: next.address }
    if (next.notes.trim()) location.notes = next.notes
    return location
  })
}

export function CallSheetShootLocations({ locations, scenes, editable, onChangeLocations, onChangeScenes }: Props) {
  if (!callSheetShootLocationsEnabled()) return null
  const canAdd = canAddCallSheetLocation(locations.length)

  const remove = (index: number) => {
    const location = locations[index]
    if (!location) return
    const drop = () => {
      const used = scenesUsingCallSheetLocation(scenes, location.id)
      if (used > 0) onChangeScenes(unlinkCallSheetLocation(scenes, location))
      onChangeLocations(locations.filter((_, i) => i !== index))
    }
    const used = scenesUsingCallSheetLocation(scenes, location.id)
    if (used === 0) {
      drop()
      return
    }
    const label = used === 1 ? '1 scene' : `${used} scenes`
    Alert.alert('Remove location', `Used in ${label}. Remove anyway?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: drop },
    ])
  }

  const openMaps = (address: string) => {
    const url = callSheetMapsUrl(address, Platform.OS === 'android' ? 'android' : 'ios')
    if (url) void Linking.openURL(url)
  }

  return (
    <View style={styles.wrap}>
      {locations.map((location, index) => {
        const maps = callSheetMapsUrl(location.address, 'web')
        return (
          <View key={location.id} style={styles.card}>
            {index === 0 ? <Text style={styles.main}>Main location</Text> : null}
            <Text style={styles.label}>Name</Text>
            {editable ? (
              <TextInput
                style={styles.input}
                value={location.name}
                maxLength={CALL_SHEET_LOCATION_NAME_LIMIT}
                onChangeText={(value) => onChangeLocations(patchLocation(locations, index, { name: value }))}
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
            ) : (
              <Text style={styles.value}>{location.name.trim() || 'Untitled'}</Text>
            )}
            <Text style={styles.label}>Address</Text>
            {editable ? (
              <TextInput
                style={styles.input}
                value={location.address}
                maxLength={CALL_SHEET_LOCATION_ADDRESS_LIMIT}
                onChangeText={(value) => onChangeLocations(patchLocation(locations, index, { address: value }))}
                placeholder="Street, city"
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
            ) : (
              <Text style={styles.value}>{location.address.trim() || 'No address'}</Text>
            )}
            {maps ? (
              <TouchableOpacity onPress={() => openMaps(location.address)} accessibilityRole="link">
                <Text style={styles.maps}>Open in Maps</Text>
              </TouchableOpacity>
            ) : null}
            {editable || location.notes?.trim() ? <Text style={styles.label}>Notes</Text> : null}
            {editable ? (
              <TextInput
                style={[styles.input, styles.notes]}
                value={location.notes ?? ''}
                maxLength={CALL_SHEET_LOCATION_NOTES_LIMIT}
                multiline
                onChangeText={(value) => onChangeLocations(patchLocation(locations, index, { notes: value }))}
                placeholderTextColor="rgba(255,255,255,0.25)"
              />
            ) : location.notes?.trim() ? (
              <Text style={styles.value}>{location.notes}</Text>
            ) : null}
            {editable ? (
              <View style={styles.actions}>
                <TouchableOpacity disabled={index === 0} onPress={() => onChangeLocations(moveCallSheetLocation(locations, index, -1))}>
                  <Text style={[styles.action, index === 0 && styles.actionOff]}>Up</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={index === locations.length - 1}
                  onPress={() => onChangeLocations(moveCallSheetLocation(locations, index, 1))}
                >
                  <Text style={[styles.action, index === locations.length - 1 && styles.actionOff]}>Down</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => remove(index)}>
                  <Text style={styles.action}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )
      })}
      {editable ? (
        <TouchableOpacity
          style={[styles.add, !canAdd && styles.addOff]}
          disabled={!canAdd}
          onPress={() => onChangeLocations([...locations, { id: newCallSheetLocationId(), name: '', address: '' }])}
        >
          <Text style={styles.addText}>Add location</Text>
        </TouchableOpacity>
      ) : null}
      {editable && !canAdd ? <Text style={styles.hint}>{CALL_SHEET_LOCATION_LIMIT_HINT}</Text> : null}
    </View>
  )
}

export function shootLocationsPreview(locations: CallSheetLocation[]): string {
  return locations[0]?.name.trim() || (locations.length ? 'Untitled' : 'None yet')
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  card: {
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 12,
    gap: 6,
  },
  main: { color: '#FFDC00', fontSize: 10, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  label: { color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 4 },
  input: {
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 14,
  },
  notes: { minHeight: 64, textAlignVertical: 'top' },
  value: { color: '#fff', fontSize: 14 },
  maps: { color: '#FFDC00', fontSize: 13, fontWeight: '800', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 4 },
  action: { color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '700' },
  actionOff: { opacity: 0.3 },
  add: { alignSelf: 'flex-start', backgroundColor: '#FFDC00', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  addOff: { opacity: 0.4 },
  addText: { color: '#0a0a0a', fontWeight: '800', fontSize: 14 },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
})
