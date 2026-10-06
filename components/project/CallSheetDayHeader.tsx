import { useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ChevronDown, Clock, Cloud, MapPin, Shield } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import {
  CALL_SHEET_PLACE_ORDER,
  DEFAULT_CALL_SHEET_SAFETY,
  callSheetDayLabel,
  formatCallSheetDate,
  type CallSheetContacts,
  type CallSheetDayTimes,
  type CallSheetDepartments,
  type CallSheetPlaces,
} from '@/lib/callSheet'
import { fetchCallSheetAtmosphere, type CallSheetAtmosphere } from '@/lib/openMeteoWeather'

type Props = {
  projectTitle: string
  shootDay: string
  projectLocation: string | null
  dayNumber: number | null
  dayCount: number | null
  wrapTime: string
  notes: string
  day: CallSheetDayTimes
  places: CallSheetPlaces
  special: string
  departments: CallSheetDepartments
  contacts: CallSheetContacts
  editable: boolean
  weatherEnabled: boolean
  onChangeDay: (patch: Partial<CallSheetDayTimes>) => void
  onChangePlaces: (patch: Partial<CallSheetPlaces>) => void
  onChangeSpecial: (value: string) => void
  onChangeDepartments: (patch: Partial<CallSheetDepartments>) => void
  onChangeContacts: (patch: Partial<CallSheetContacts>) => void
  onChangeWrap: (value: string) => void
  onChangeNotes: (value: string) => void
  you?: { name: string; roleLabel: string; call: string; location: string } | null
  children?: ReactNode
}

function firstLine(value: string, empty = '—') {
  const t = value.trim()
  if (!t) return empty
  return t.split('\n')[0].trim() || empty
}

function Fold({
  title,
  preview,
  warn,
  defaultOpen = false,
  children,
}: {
  title: string
  preview?: string
  warn?: boolean
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <View style={[styles.fold, warn && styles.foldWarn]}>
      <TouchableOpacity style={styles.foldHead} onPress={() => setOpen((v) => !v)} activeOpacity={0.8}>
        <View style={styles.foldHeadText}>
          <Text style={[styles.foldTitle, warn && styles.foldTitleWarn]}>{title}</Text>
          {!open && preview ? (
            <Text style={styles.foldPreview} numberOfLines={1}>
              {preview}
            </Text>
          ) : null}
        </View>
        <ChevronDown
          size={18}
          color={warn ? 'rgba(255,180,80,0.9)' : 'rgba(255,255,255,0.4)'}
          strokeWidth={ICON_STROKE}
          style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
        />
      </TouchableOpacity>
      {open ? <View style={styles.foldBody}>{children}</View> : null}
    </View>
  )
}

function Field({
  label,
  value,
  placeholder,
  editable,
  onChange,
  multiline,
}: {
  label: string
  value: string
  placeholder: string
  editable: boolean
  onChange: (v: string) => void
  multiline?: boolean
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputTall]}
        value={value}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.25)"
        editable={editable}
        onChangeText={onChange}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  )
}

export function CallSheetDayHeader({
  projectTitle,
  shootDay,
  projectLocation,
  dayNumber,
  dayCount,
  wrapTime,
  notes,
  day,
  places,
  special,
  departments,
  contacts,
  editable,
  weatherEnabled,
  onChangeDay,
  onChangePlaces,
  onChangeSpecial,
  onChangeDepartments,
  onChangeContacts,
  onChangeWrap,
  onChangeNotes,
  you,
  children,
}: Props) {
  const [weather, setWeather] = useState<CallSheetAtmosphere | null>(null)
  const [weatherError, setWeatherError] = useState<string | null>(null)

  useEffect(() => {
    if (!weatherEnabled) {
      setWeather(null)
      setWeatherError(null)
      return
    }
    const loc = projectLocation?.trim()
    if (!loc) {
      setWeather(null)
      setWeatherError(null)
      return
    }
    let cancelled = false
    setWeatherError(null)
    void (async () => {
      try {
        const next = await fetchCallSheetAtmosphere({ locationQuery: loc, date: shootDay })
        if (cancelled) return
        setWeather(next)
        if (!next) setWeatherError('No forecast for this day.')
      } catch (e) {
        if (cancelled) return
        setWeather(null)
        setWeatherError(e instanceof Error ? e.message : 'Weather unavailable')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [weatherEnabled, projectLocation, shootDay])

  const dayLabel = callSheetDayLabel(dayNumber, dayCount)
  const hospitalEmpty = !places.hospital.trim()
  const filledPlaces = CALL_SHEET_PLACE_ORDER.filter((p) => places[p.key].trim()).length
  const weatherPreview = weather
    ? `${weather.high}° / ${weather.low}° · ${weather.summary}`
    : weatherError ?? 'Forecast'
  const safetyPreview = firstLine(day.safety_meeting || day.safety_note, 'Safety notes')
  const notesPreview = firstLine(notes, 'Day notes')
  const medicSet = Boolean(contacts.medic_name?.trim() || contacts.medic_phone?.trim())
  const placesPreview = hospitalEmpty
    ? `${filledPlaces}/5 · Hospital missing`
    : `${filledPlaces}/5 set${medicSet ? ' · Medic' : ''}`
  const specialPreview = firstLine(special, 'None')
  const deptPreview =
    [departments.camera && 'Camera', departments.sound && 'Sound', departments.wardrobe && 'Wardrobe']
      .filter(Boolean)
      .join(' · ') || 'None'
  const contactsPreview =
    [contacts.upm && `UPM ${contacts.upm}`, contacts.first_ad && `1st ${contacts.first_ad}`, contacts.second_ad && `2nd ${contacts.second_ad}`]
      .filter(Boolean)
      .join(' · ') || 'None'

  return (
    <View style={styles.wrap}>
      <View style={styles.callCard}>
        <View style={styles.callTop}>
          <View style={styles.callTopText}>
            <Text style={styles.kicker}>General crew call</Text>
            <Text style={styles.project} numberOfLines={2}>
              {projectTitle}
            </Text>
            <Text style={styles.dateLine}>{formatCallSheetDate(shootDay)}</Text>
            {dayLabel ? <Text style={styles.dayOf}>{dayLabel}</Text> : null}
          </View>
          <View style={styles.callTimeBox}>
            <TextInput
              style={styles.callTimeInput}
              value={day.general_call}
              placeholder="—"
              placeholderTextColor="rgba(10,10,10,0.35)"
              editable={editable}
              onChangeText={(v) => onChangeDay({ general_call: v })}
              textAlign="center"
            />
          </View>
        </View>
        <View style={styles.chipRow}>
          <Chip label="Breakfast" value={day.breakfast} placeholder="—" editable={editable} onChange={(v) => onChangeDay({ breakfast: v })} />
          <Chip label="Shoot" value={day.shoot_call} placeholder="—" editable={editable} onChange={(v) => onChangeDay({ shoot_call: v })} />
          <Chip label="Lunch" value={day.lunch} placeholder="—" editable={editable} onChange={(v) => onChangeDay({ lunch: v })} />
          <Chip label="Wrap" value={wrapTime} placeholder="—" editable={editable} onChange={onChangeWrap} />
        </View>
      </View>

      {you ? (
        <View style={styles.youCard}>
          <Text style={styles.youKicker}>Your call</Text>
          <View style={styles.youRow}>
            <View style={styles.youTimeBox}>
              <Clock size={16} color="#0a0a0a" strokeWidth={ICON_STROKE} />
              <Text style={styles.youTime}>{you.call.trim() || '—'}</Text>
            </View>
            <View style={styles.youMeta}>
              <Text style={styles.youName} numberOfLines={1}>
                {you.name || 'You'}
                {you.roleLabel ? ` · ${you.roleLabel}` : ''}
              </Text>
              <View style={styles.youLocRow}>
                <MapPin size={14} color="rgba(255,220,0,0.85)" strokeWidth={ICON_STROKE} />
                <Text style={styles.youLoc} numberOfLines={2}>
                  {you.location.trim() || 'Location still open'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {children}

      <Fold title="Notes" preview={notesPreview} defaultOpen={Boolean(notes.trim())}>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={notes}
          placeholder="Schedule, travel, what happened, what's next…"
          placeholderTextColor="rgba(255,255,255,0.25)"
          editable={editable}
          onChangeText={onChangeNotes}
          multiline
          textAlignVertical="top"
        />
      </Fold>

      <Fold title="Key locations" preview={placesPreview} warn={hospitalEmpty} defaultOpen={hospitalEmpty}>
        <View style={styles.placesHead}>
          <MapPin size={16} color="rgba(255,255,255,0.45)" strokeWidth={ICON_STROKE} />
          <Text style={styles.placesTitle}>Parking, basecamp, HMU, wardrobe, hospital</Text>
        </View>
        <View style={styles.placesGrid}>
          {CALL_SHEET_PLACE_ORDER.map((place) => {
            const warn = place.key === 'hospital' && hospitalEmpty
            return (
              <View key={place.key} style={[styles.placeCard, warn && styles.placeCardWarn]}>
                <Text style={[styles.placeLabel, warn && styles.placeLabelWarn]}>{place.label}</Text>
                <TextInput
                  style={styles.placeInput}
                  value={places[place.key]}
                  placeholder={place.key === 'hospital' ? 'Nearest ER — required' : 'Address / stage'}
                  placeholderTextColor={warn ? 'rgba(255,180,80,0.55)' : 'rgba(255,255,255,0.25)'}
                  editable={editable}
                  onChangeText={(v) => onChangePlaces({ [place.key]: v })}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            )
          })}
        </View>
        {hospitalEmpty ? (
          <Text style={styles.hospitalHint}>Add the nearest hospital — this is the first thing crew look for.</Text>
        ) : null}
        <Field
          label="Set medic"
          value={contacts.medic_name ?? ''}
          placeholder="Name"
          editable={editable}
          onChange={(v) => onChangeContacts({ medic_name: v })}
        />
        <Field
          label="Medic phone"
          value={contacts.medic_phone ?? ''}
          placeholder="Phone"
          editable={editable}
          onChange={(v) => onChangeContacts({ medic_phone: v })}
        />
      </Fold>

      {weatherEnabled ? (
        <Fold title="Weather" preview={weatherPreview}>
          <View style={styles.sideHead}>
            <Cloud size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.sideKicker}>Live forecast</Text>
          </View>
          {weather ? (
            <>
              <Text style={styles.weatherTemp}>
                {weather.high}° / {weather.low}°
              </Text>
              <Text style={styles.weatherSummary}>{weather.summary}</Text>
              <Text style={styles.weatherSun}>
                {weather.sunrise ? `Sunrise ${weather.sunrise}` : 'Sunrise —'}
                {'  ·  '}
                {weather.sunset ? `Sunset ${weather.sunset}` : 'Sunset —'}
              </Text>
              {weather.precipProbMax != null ? (
                <Text style={styles.weatherSun}>Rain {weather.precipProbMax}%</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.muted}>{weatherError ?? 'Loading forecast…'}</Text>
          )}
        </Fold>
      ) : null}

      <Fold title="Safety first" preview={safetyPreview}>
        <View style={styles.sideHead}>
          <Shield size={16} color="#FFDC00" strokeWidth={ICON_STROKE} />
          <Text style={styles.sideKicker}>On-set safety</Text>
        </View>
        <TextInput
          style={styles.input}
          value={day.safety_meeting}
          placeholder="Meeting 6:45 · Basecamp"
          placeholderTextColor="rgba(255,255,255,0.25)"
          editable={editable}
          onChangeText={(v) => onChangeDay({ safety_meeting: v })}
        />
        <TextInput
          style={[styles.input, styles.inputTall, { marginTop: 8 }]}
          value={day.safety_note}
          placeholder={DEFAULT_CALL_SHEET_SAFETY}
          placeholderTextColor="rgba(255,255,255,0.25)"
          editable={editable}
          onChangeText={(v) => onChangeDay({ safety_note: v })}
          multiline
          textAlignVertical="top"
        />
      </Fold>

      <Fold title="Special instructions" preview={specialPreview}>
        <Field
          label="Set rules"
          value={special}
          placeholder="Closed-toe shoes, rain cover, set rules…"
          editable={editable}
          onChange={onChangeSpecial}
          multiline
        />
      </Fold>

      <Fold title="Department notes" preview={deptPreview}>
        <Field
          label="Camera"
          value={departments.camera}
          placeholder="Handheld package"
          editable={editable}
          onChange={(v) => onChangeDepartments({ camera: v })}
        />
        <Field
          label="Sound"
          value={departments.sound}
          placeholder="Wireless mics"
          editable={editable}
          onChange={(v) => onChangeDepartments({ sound: v })}
        />
        <Field
          label="Wardrobe note"
          value={departments.wardrobe}
          placeholder="Hero jacket backup"
          editable={editable}
          onChange={(v) => onChangeDepartments({ wardrobe: v })}
        />
      </Fold>

      <Fold title="Production contacts" preview={contactsPreview}>
        <Field label="UPM" value={contacts.upm} placeholder="Name" editable={editable} onChange={(v) => onChangeContacts({ upm: v })} />
        <Field
          label="1st AD"
          value={contacts.first_ad}
          placeholder="Name"
          editable={editable}
          onChange={(v) => onChangeContacts({ first_ad: v })}
        />
        <Field
          label="2nd AD"
          value={contacts.second_ad}
          placeholder="Name"
          editable={editable}
          onChange={(v) => onChangeContacts({ second_ad: v })}
        />
      </Fold>
    </View>
  )
}

function Chip({
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
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <TextInput
        style={styles.chipInput}
        value={value}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.28)"
        editable={editable}
        onChangeText={onChange}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  callCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.28)',
    backgroundColor: '#121212',
    padding: 16,
    marginBottom: 12,
  },
  callTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginBottom: 14 },
  callTopText: { flex: 1, minWidth: 0 },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255,220,0,0.85)',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  project: { fontSize: 18, fontWeight: '800', color: '#fff', marginBottom: 4 },
  dateLine: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontWeight: '600' },
  dayOf: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '800',
    color: '#FFDC00',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  callTimeBox: {
    minWidth: 118,
    backgroundColor: '#FFDC00',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callTimeInput: {
    color: '#0a0a0a',
    fontSize: 22,
    fontWeight: '900',
    minWidth: 96,
    padding: 0,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  youCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.55)',
    backgroundColor: '#16140a',
    padding: 16,
    marginBottom: 12,
  },
  youKicker: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFDC00',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  youRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  youTimeBox: {
    backgroundColor: '#FFDC00',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 118,
  },
  youTime: { color: '#0a0a0a', fontSize: 20, fontWeight: '900' },
  youMeta: { flex: 1, minWidth: 0 },
  youName: { fontSize: 15, fontWeight: '800', color: '#fff', marginBottom: 4 },
  youLocRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  youLoc: { flex: 1, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.72)', lineHeight: 18 },
  chip: {
    flexGrow: 1,
    minWidth: '45%',
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  chipInput: { color: '#fff', fontSize: 14, fontWeight: '700', padding: 0 },
  fold: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 10,
    overflow: 'hidden',
  },
  foldWarn: {
    borderColor: 'rgba(255,180,80,0.55)',
    backgroundColor: 'rgba(255,180,80,0.06)',
  },
  foldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  foldHeadText: { flex: 1, minWidth: 0 },
  foldTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  foldTitleWarn: { color: 'rgba(255,180,80,0.95)' },
  foldPreview: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.72)',
  },
  foldBody: { paddingHorizontal: 14, paddingBottom: 14 },
  sideHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sideKicker: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  weatherTemp: { fontSize: 20, fontWeight: '900', color: '#fff', marginBottom: 4 },
  weatherSummary: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 6 },
  weatherSun: { fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 16 },
  muted: { fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 17 },
  placesHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  placesTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.4)',
    flex: 1,
  },
  placesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  placeCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 10,
    minHeight: 88,
  },
  placeCardWarn: {
    borderColor: 'rgba(255,180,80,0.55)',
    backgroundColor: 'rgba(255,180,80,0.06)',
  },
  placeLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  placeLabelWarn: { color: 'rgba(255,180,80,0.9)' },
  placeInput: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    minHeight: 44,
    padding: 0,
  },
  hospitalHint: {
    fontSize: 12,
    color: 'rgba(255,180,80,0.85)',
    marginTop: 4,
    lineHeight: 17,
  },
  field: { marginBottom: 12, flex: 1, minWidth: 0 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  inputTall: { minHeight: 72, paddingTop: 11 },
  notesInput: { minHeight: 140, paddingTop: 11 },
})
