import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import {
  fetchForecast7Days,
  geocodeLocation,
  suggestLocations,
  type DailyForecastDay,
  type GeocodeHit,
} from '@/lib/openMeteoWeather'
import { canShowShadowMap, isShadowMapFeatureEnabled } from '@/lib/mapboxConfig'
import { ProductionShadowMapSection } from '@/components/project/ProductionShadowMapSection'
import { TimeScrubSlider } from '@/components/project/TimeScrubSlider'

type Props = {
  initialLocation?: string | null
}

type SunDaily = {
  sunrise: string
  sunset: string
  daylightSeconds: number | null
}

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function nowHHmm(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function parseDate(input: string): string | null {
  const t = input.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const d = new Date(`${t}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : t
}

function parseTime(input: string): string | null {
  const t = input.trim()
  if (!/^\d{2}:\d{2}$/.test(t)) return null
  const [h, m] = t.split(':').map((x) => Number(x))
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function shiftHHmm(input: string, deltaMinutes: number): string {
  const parsed = parseTime(input)
  const base = parsed ?? '12:00'
  const [h, m] = base.split(':').map((x) => Number(x))
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function hhmmToMinutes(input: string): number | null {
  const parsed = parseTime(input)
  if (!parsed) return null
  const [h, m] = parsed.split(':').map((x) => Number(x))
  return h * 60 + m
}

function minutesToHHmm(value: number): string {
  const total = (((Math.round(value) % 1440) + 1440) % 1440)
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function fmtClock(isoLike: string): string {
  const d = new Date(isoLike)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isoToHHmm(isoLike: string): string | null {
  const d = new Date(isoLike)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function solarPositionApprox(lat: number, lon: number, date: Date) {
  const rad = Math.PI / 180
  const dayMs = 1000 * 60 * 60 * 24
  const J1970 = 2440588
  const J2000 = 2451545
  const e = rad * 23.4397
  const toJulian = date.valueOf() / dayMs - 0.5 + J1970
  const d = toJulian - J2000

  const M = rad * (357.5291 + 0.98560028 * d)
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const P = rad * 102.9372
  const L = M + C + P + Math.PI
  const dec = Math.asin(Math.sin(L) * Math.sin(e))
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L))
  const lw = -lon * rad
  const phi = lat * rad
  const sidereal = rad * (280.16 + 360.9856235 * d) - lw
  const H = sidereal - ra

  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))
  const altitudeDeg = altitude / rad
  const bearing = (((azimuth / rad) + 180) % 360 + 360) % 360
  return { altitudeDeg, bearingDeg: bearing }
}

async function fetchSunDaily(lat: number, lon: number, dateIso: string): Promise<SunDaily | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'sunrise,sunset,daylight_duration',
    timezone: 'auto',
    start_date: dateIso,
    end_date: dateIso,
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`)
  if (!res.ok) throw new Error('Could not load sun data')
  const data = (await res.json()) as {
    daily?: {
      sunrise?: string[]
      sunset?: string[]
      daylight_duration?: number[]
    }
  }
  const sunrise = data.daily?.sunrise?.[0]
  const sunset = data.daily?.sunset?.[0]
  if (!sunrise || !sunset) return null
  return {
    sunrise,
    sunset,
    daylightSeconds: typeof data.daily?.daylight_duration?.[0] === 'number' ? data.daily.daylight_duration[0] : null,
  }
}

export function ProductionSunPlannerSection({ initialLocation }: Props) {
  const [query, setQuery] = useState('')
  const [dateInput, setDateInput] = useState(todayIso())
  const [timeInput, setTimeInput] = useState(nowHHmm())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [latLon, setLatLon] = useState<{ lat: number; lon: number } | null>(null)
  const [sun, setSun] = useState<SunDaily | null>(null)
  const [suggestions, setSuggestions] = useState<GeocodeHit[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [subjectHeightM, setSubjectHeightM] = useState('2.0')
  const [subjectLatLon, setSubjectLatLon] = useState<{ lat: number; lon: number } | null>(null)
  const [forecast, setForecast] = useState<DailyForecastDay[]>([])
  const [forecastError, setForecastError] = useState<string | null>(null)
  const [weatherOpen, setWeatherOpen] = useState(false)

  useEffect(() => {
    setQuery((prev) => (prev.trim() ? prev : initialLocation?.trim() ?? ''))
  }, [initialLocation])

  useEffect(() => {
    if (latLon) setSubjectLatLon(latLon)
    else setSubjectLatLon(null)
  }, [latLon])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) {
      setSuggestions([])
      setLoadingSuggestions(false)
      return
    }
    let cancelled = false
    setLoadingSuggestions(true)
    const t = setTimeout(() => {
      void (async () => {
        const rows = await suggestLocations(q)
        if (cancelled) return
        setSuggestions(rows)
        setLoadingSuggestions(false)
      })()
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  const loadSun = useCallback(async () => {
    const q = query.trim()
    const d = parseDate(dateInput)
    const t = parseTime(timeInput)
    if (!q) {
      Alert.alert('Sun Planner', 'Enter a location first.')
      return
    }
    if (!d) {
      Alert.alert('Sun Planner', 'Use a valid date format: YYYY-MM-DD.')
      return
    }
    if (!t) {
      Alert.alert('Sun Planner', 'Use a valid time format: HH:MM.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const geo = await geocodeLocation(q)
      if (!geo) {
        setError('Location not found. Please check spelling.')
        setLabel(null)
        setLatLon(null)
        setSun(null)
        setForecast([])
        setForecastError(null)
        return
      }
      const [s, forecastResult] = await Promise.all([
        fetchSunDaily(geo.lat, geo.lon, d),
        fetchForecast7Days(geo.lat, geo.lon).then(
          (days) => ({ days, error: null as string | null }),
          (err: unknown) => ({
            days: [] as DailyForecastDay[],
            error: err instanceof Error ? err.message : 'Could not load weather.',
          })
        ),
      ])
      setLabel(geo.label)
      setLatLon({ lat: geo.lat, lon: geo.lon })
      setSun(s)
      setForecast(forecastResult.days)
      setForecastError(forecastResult.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load sun planner data.')
      setSun(null)
      setForecast([])
      setForecastError(null)
    } finally {
      setLoading(false)
    }
  }, [query, dateInput, timeInput])

  const angleData = useMemo(() => {
    if (!latLon) return null
    const d = parseDate(dateInput)
    const t = parseTime(timeInput)
    if (!d || !t) return null
    const dt = new Date(`${d}T${t}:00`)
    if (Number.isNaN(dt.getTime())) return null
    const pos = solarPositionApprox(latLon.lat, latLon.lon, dt)
    return {
      altitude: Math.round(pos.altitudeDeg * 10) / 10,
      azimuth: Math.round(pos.bearingDeg * 10) / 10,
    }
  }, [latLon, dateInput, timeInput])

  const daylightHours =
    sun?.daylightSeconds != null ? `${(sun.daylightSeconds / 3600).toFixed(1)} h` : '—'

  const sunFacts = useMemo(() => {
    const sunrise = sun ? fmtClock(sun.sunrise) : '—'
    const sunset = sun ? fmtClock(sun.sunset) : '—'
    const sunriseMs = sun ? new Date(sun.sunrise).getTime() : NaN
    const sunsetMs = sun ? new Date(sun.sunset).getTime() : NaN
    const goldenEndIso = Number.isFinite(sunriseMs) ? new Date(sunriseMs + 60 * 60 * 1000).toISOString() : null
    const eveningStartIso = Number.isFinite(sunsetMs) ? new Date(sunsetMs - 60 * 60 * 1000).toISOString() : null
    const goldenEnd = goldenEndIso ? fmtClock(goldenEndIso) : '—'
    const eveningStart = eveningStartIso ? fmtClock(eveningStartIso) : '—'
    return [
      { key: 'sunrise', label: 'Sunrise', value: sunrise, jump: sun ? isoToHHmm(sun.sunrise) : null },
      { key: 'sunset', label: 'Sunset', value: sunset, jump: sun ? isoToHHmm(sun.sunset) : null },
      { key: 'daylight', label: 'Daylight', value: daylightHours, jump: null },
      {
        key: 'golden',
        label: 'Golden hour (approx)',
        value: sun && goldenEnd !== '—' ? `${sunrise}–${goldenEnd}` : '—',
        jump: sun ? isoToHHmm(sun.sunrise) : null,
      },
      {
        key: 'evening',
        label: 'Evening golden hour (approx)',
        value: sun && eveningStart !== '—' ? `${eveningStart}–${sunset}` : '—',
        jump: eveningStartIso ? isoToHHmm(eveningStartIso) : null,
      },
    ]
  }, [sun, daylightHours])

  const sliderMinutes = useMemo(() => hhmmToMinutes(timeInput) ?? 12 * 60, [timeInput])
  const mapReady = isShadowMapFeatureEnabled() && !!latLon && !!subjectLatLon && !!angleData
  const mapHasScrub = mapReady && canShowShadowMap()
  const subjectHeight = (() => {
    const h = Number(subjectHeightM.replace(',', '.'))
    return Number.isFinite(h) && h > 0 ? h : 2
  })()

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionHead}>SUN PLANNER</Text>
      <Text style={styles.sub}>
        Plan natural light on the map. Sunrise, sunset, and a 7-day forecast come from Open-Meteo.
      </Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="e.g. Berlin, DE"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={query}
          onChangeText={(v) => {
            setQuery(v)
            setError(null)
          }}
        />
      </View>
      {query.trim().length >= 3 ? (
        <View style={styles.suggestWrap}>
          {loadingSuggestions ? <Text style={styles.suggestInfo}>Searching…</Text> : null}
          {!loadingSuggestions &&
            suggestions.map((s) => (
              <TouchableOpacity
                key={`${s.lat}:${s.lon}:${s.label}`}
                style={styles.suggestItem}
                onPress={() => {
                  setQuery(s.label)
                  setSuggestions([])
                  setLabel(s.label)
                  setLatLon({ lat: s.lat, lon: s.lon })
                  setError(null)
                }}
              >
                <Text style={styles.suggestText} numberOfLines={1}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
        </View>
      ) : null}
      <View style={styles.row2}>
        <TextInput
          style={[styles.input, styles.half]}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={dateInput}
          onChangeText={setDateInput}
        />
        <TextInput
          style={[styles.input, styles.half]}
          placeholder="HH:MM"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={timeInput}
          onChangeText={setTimeInput}
        />
      </View>
      {!mapHasScrub ? (
        <>
          <View style={styles.timeStepRow}>
            <TouchableOpacity style={styles.timeStepBtn} onPress={() => setTimeInput((v) => shiftHHmm(v, -30))}>
              <Text style={styles.timeStepText}>-30m</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.timeStepBtn} onPress={() => setTimeInput((v) => shiftHHmm(v, -15))}>
              <Text style={styles.timeStepText}>-15m</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.timeStepBtn} onPress={() => setTimeInput(nowHHmm())}>
              <Text style={styles.timeStepText}>Now</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.timeStepBtn} onPress={() => setTimeInput((v) => shiftHHmm(v, 15))}>
              <Text style={styles.timeStepText}>+15m</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.timeStepBtn} onPress={() => setTimeInput((v) => shiftHHmm(v, 30))}>
              <Text style={styles.timeStepText}>+30m</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.timeSliderWrap}>
            <View style={styles.timeSliderHead}>
              <Text style={styles.timeSliderLabel}>Time scrub</Text>
              <Text style={styles.timeSliderValue}>{timeInput}</Text>
            </View>
            <TimeScrubSlider
              minimumValue={0}
              maximumValue={1439}
              value={sliderMinutes}
              onValueChange={(v) => setTimeInput(minutesToHHmm(v))}
            />
          </View>
        </>
      ) : null}
      <TouchableOpacity style={[styles.btn, loading && styles.dim]} onPress={loadSun} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Loading…' : 'Load sun data'}</Text>
      </TouchableOpacity>

      <View style={styles.presetsRow}>
        {sunFacts.map((fact) => {
          const body = (
            <>
              <Text style={styles.presetBtnLabel}>{fact.label}</Text>
              <Text style={styles.presetBtnValue}>{fact.value}</Text>
            </>
          )
          if (!fact.jump || loading) {
            return (
              <View key={fact.key} style={styles.presetBtn}>
                {body}
              </View>
            )
          }
          return (
            <TouchableOpacity
              key={fact.key}
              style={styles.presetBtn}
              onPress={() => {
                if (fact.jump) setTimeInput(fact.jump)
              }}
            >
              {body}
            </TouchableOpacity>
          )
        })}
      </View>

      {error ? <Text style={styles.err}>{error}</Text> : null}
      {label ? <Text style={styles.location}>{label}</Text> : null}

      {mapReady && latLon && subjectLatLon && angleData ? (
        <View style={styles.card}>
          <View style={styles.shadowInputRow}>
            <Text style={styles.shadowInputLabel}>Subject height (m)</Text>
            <TextInput
              style={styles.shadowInput}
              value={subjectHeightM}
              onChangeText={setSubjectHeightM}
              keyboardType="decimal-pad"
              placeholder="2.0"
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
          </View>
          <ProductionShadowMapSection
            center={latLon}
            subject={subjectLatLon}
            onSubjectChange={(lat, lon) => setSubjectLatLon({ lat, lon })}
            onResetSubject={() => {
              if (latLon) setSubjectLatLon(latLon)
            }}
            sunAzimuthDeg={angleData.azimuth}
            sunAltitudeDeg={angleData.altitude}
            subjectHeightM={subjectHeight}
            timeLabel={timeInput}
            timeMinutes={sliderMinutes}
            onTimeMinutesChange={(minutes) => setTimeInput(minutesToHHmm(minutes))}
            onNudgeMinutes={(delta) => setTimeInput((v) => shiftHHmm(v, delta))}
            onSetNow={() => setTimeInput(nowHHmm())}
          />
        </View>
      ) : null}

      {forecastError ? <Text style={styles.err}>{forecastError}</Text> : null}
      {forecast.length > 0 ? (
        <View style={styles.card}>
          <TouchableOpacity
            style={[styles.forecastToggle, weatherOpen && styles.forecastToggleOpen]}
            onPress={() => setWeatherOpen((open) => !open)}
            accessibilityRole="button"
          >
            <Text style={styles.forecastHead}>Weather · 7 days</Text>
            <Text style={styles.forecastChevron}>{weatherOpen ? '▴' : '▾'}</Text>
          </TouchableOpacity>
          {weatherOpen ? (
            <>
              <View style={styles.forecastHeadRow}>
                <Text style={[styles.forecastHint, styles.forecastColTag]}>Day</Text>
                <Text style={[styles.forecastHint, styles.forecastColTemp]}>high / low</Text>
                <Text style={[styles.forecastHint, styles.forecastColRain]}>rain</Text>
              </View>
              {forecast.map((day) => (
                <View key={day.date} style={styles.forecastDayRow}>
                  <View style={styles.forecastDayLeft}>
                    <Text style={styles.forecastDate}>
                      {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                    <Text style={styles.forecastSummary} numberOfLines={2}>
                      {day.summary}
                    </Text>
                  </View>
                  <Text style={[styles.forecastTemps, styles.forecastColTemp]}>
                    {day.tempMax}° / {day.tempMin}°
                  </Text>
                  <Text style={[styles.forecastRain, styles.forecastColRain]}>
                    {day.precipProbMax != null ? `${day.precipProbMax}%` : '—'}
                  </Text>
                </View>
              ))}
              <Text style={styles.forecastAttr}>Data: Open-Meteo</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  sectionHead: {
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 2,
    marginBottom: 12,
  },
  sub: { fontSize: 12, color: 'rgba(255,255,255,0.38)', lineHeight: 17, marginBottom: 12 },
  row: { marginBottom: 8 },
  row2: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  timeStepRow: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  timeStepBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    paddingVertical: 7,
    paddingHorizontal: 11,
    backgroundColor: '#121212',
  },
  timeStepText: { color: 'rgba(255,255,255,0.88)', fontWeight: '700', fontSize: 11 },
  timeSliderWrap: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    backgroundColor: '#111',
    paddingHorizontal: 10,
    paddingTop: 9,
    paddingBottom: 4,
    marginBottom: 10,
  },
  timeSliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timeSliderLabel: { color: 'rgba(255,255,255,0.58)', fontSize: 11, fontWeight: '700' },
  timeSliderValue: { color: '#FFDC00', fontSize: 12, fontWeight: '800' },
  input: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  half: { flex: 1 },
  btn: {
    borderRadius: 12,
    backgroundColor: '#378ADD',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 10,
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.55 },
  presetsRow: { marginBottom: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#121212',
    paddingHorizontal: 10,
    paddingVertical: 7,
    minWidth: 78,
  },
  presetBtnLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700' },
  presetBtnValue: { color: '#FFDC00', fontSize: 12, fontWeight: '800', marginTop: 1 },
  err: { fontSize: 13, color: 'rgba(255,100,100,0.9)', marginBottom: 8 },
  location: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 10 },
  suggestWrap: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#101010',
    marginTop: -2,
    marginBottom: 8,
    overflow: 'hidden',
  },
  suggestInfo: { color: 'rgba(255,255,255,0.45)', fontSize: 12, paddingHorizontal: 12, paddingVertical: 10 },
  suggestItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  suggestText: { color: 'rgba(255,255,255,0.88)', fontSize: 13 },
  card: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 12,
    marginBottom: 10,
  },
  shadowInputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 },
  shadowInputLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '700' },
  shadowInput: {
    width: 90,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#0f0f0f',
    color: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 13,
    textAlign: 'right',
  },
  forecastToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  forecastToggleOpen: { marginBottom: 10 },
  forecastHead: { color: '#fff', fontSize: 14, fontWeight: '800' },
  forecastChevron: { color: '#FFDC00', fontSize: 14, fontWeight: '800' },
  forecastHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  forecastHint: { fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 0.5 },
  forecastColTag: { flex: 1 },
  forecastColTemp: { width: 86, textAlign: 'right' },
  forecastColRain: { width: 48, textAlign: 'right' },
  forecastDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  forecastDayLeft: { flex: 1, minWidth: 0 },
  forecastDate: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.92)' },
  forecastSummary: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  forecastTemps: { fontSize: 13, fontWeight: '600', color: '#FFDC00' },
  forecastRain: { fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  forecastAttr: { marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.35)' },
})
