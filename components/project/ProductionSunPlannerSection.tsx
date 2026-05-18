import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, NativeModules, Platform, StyleSheet, Text, TextInput, TouchableOpacity, UIManager, View } from 'react-native'
import Slider from '@react-native-community/slider'
import { geocodeLocation, suggestLocations, type GeocodeHit } from '@/lib/openMeteoWeather'
import { canShowShadowMap, isShadowMapFeatureEnabled } from '@/lib/mapboxConfig'
import { ProductionShadowMapSection } from '@/components/project/ProductionShadowMapSection'

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

function minutesOfDay(isoLike: string): number | null {
  const d = new Date(isoLike)
  if (Number.isNaN(d.getTime())) return null
  return d.getHours() * 60 + d.getMinutes()
}

function compassFromBearing(bearing: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const idx = Math.round((((bearing % 360) + 360) % 360) / 45) % 8
  return dirs[idx]
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
  const [plannerView, setPlannerView] = useState<'metrics' | 'shadow'>('metrics')
  const [subjectLatLon, setSubjectLatLon] = useState<{ lat: number; lon: number } | null>(null)
  const sliderNativeAvailable =
    Platform.OS === 'web' ||
    !!(NativeModules as Record<string, unknown>).RNCSlider ||
    !!UIManager.getViewManagerConfig?.('RNCSlider')

  useEffect(() => {
    setQuery((prev) => (prev.trim() ? prev : initialLocation?.trim() ?? ''))
  }, [initialLocation])

  useEffect(() => {
    if (latLon) setSubjectLatLon(latLon)
    else setSubjectLatLon(null)
  }, [latLon])

  useEffect(() => {
    if (!latLon) setPlannerView('metrics')
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
        return
      }
      const s = await fetchSunDaily(geo.lat, geo.lon, d)
      setLabel(geo.label)
      setLatLon({ lat: geo.lat, lon: geo.lon })
      setSun(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load sun planner data.')
      setSun(null)
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
      dir: compassFromBearing(pos.bearingDeg),
    }
  }, [latLon, dateInput, timeInput])

  const daylightHours =
    sun?.daylightSeconds != null ? `${(sun.daylightSeconds / 3600).toFixed(1)} h` : '—'

  const sunVisual = useMemo(() => {
    if (!angleData) return null
    const radius = 62
    const r = (angleData.azimuth * Math.PI) / 180
    const x = Math.sin(r) * radius
    const y = -Math.cos(r) * radius
    return {
      dotLeft: radius + x,
      dotTop: radius + y,
      beamAngle: angleData.azimuth,
      altitudeHint: angleData.altitude <= 0 ? 'Below horizon' : angleData.altitude < 15 ? 'Low sun angle' : 'High sun angle',
    }
  }, [angleData])

  const dayTimeline = useMemo(() => {
    if (!sun) return null
    const sunriseMin = minutesOfDay(sun.sunrise)
    const sunsetMin = minutesOfDay(sun.sunset)
    const selected = parseTime(timeInput)
    if (sunriseMin == null || sunsetMin == null || !selected) return null
    const [hh, mm] = selected.split(':').map((v) => Number(v))
    const selectedMin = hh * 60 + mm
    if (sunsetMin <= sunriseMin) return null
    const clamp = (v: number) => Math.max(0, Math.min(1, v))
    const selectedRatio = clamp((selectedMin - sunriseMin) / (sunsetMin - sunriseMin))
    const morningGoldenEnd = clamp(((sunriseMin + 60) - sunriseMin) / (sunsetMin - sunriseMin))
    const eveningGoldenStart = clamp(((sunsetMin - 60) - sunriseMin) / (sunsetMin - sunriseMin))
    return {
      selectedRatio,
      morningGoldenEnd,
      eveningGoldenStart,
      inDaylight: selectedMin >= sunriseMin && selectedMin <= sunsetMin,
    }
  }, [sun, timeInput])

  const shadowPreview = useMemo(() => {
    if (!angleData) return null
    if (angleData.altitude <= 0) {
      return {
        visible: false,
        lengthMeters: null as number | null,
        left: 0,
        top: 0,
        rotation: 0,
        lengthPx: 0,
      }
    }
    const h = Number(subjectHeightM.replace(',', '.'))
    const height = Number.isFinite(h) && h > 0 ? h : 2
    const altitudeRad = (angleData.altitude * Math.PI) / 180
    const lengthMeters = height / Math.tan(altitudeRad)
    const shadowBearing = (angleData.azimuth + 180) % 360
    const r = (shadowBearing * Math.PI) / 180
    const center = 92
    const lengthPx = Math.max(12, Math.min(96, lengthMeters * 4.2))
    const tipX = center + Math.sin(r) * lengthPx
    const tipY = center - Math.cos(r) * lengthPx
    return {
      visible: true,
      lengthMeters,
      left: tipX,
      top: tipY,
      rotation: shadowBearing,
      lengthPx,
    }
  }, [angleData, subjectHeightM])

  const presetTimes = useMemo(() => {
    const sunrise = sun ? isoToHHmm(sun.sunrise) : null
    const sunset = sun ? isoToHHmm(sun.sunset) : null
    const sunriseDate = sun ? new Date(sun.sunrise) : null
    const sunsetDate = sun ? new Date(sun.sunset) : null
    const morningGolden =
      sunriseDate && !Number.isNaN(sunriseDate.getTime())
        ? isoToHHmm(new Date(sunriseDate.getTime() + 45 * 60 * 1000).toISOString())
        : null
    const eveningGolden =
      sunsetDate && !Number.isNaN(sunsetDate.getTime())
        ? isoToHHmm(new Date(sunsetDate.getTime() - 45 * 60 * 1000).toISOString())
        : null
    return [
      { key: 'sunrise', label: 'Sunrise', value: sunrise },
      { key: 'golden_am', label: 'Golden AM', value: morningGolden },
      { key: 'noon', label: 'Noon', value: '12:00' },
      { key: 'golden_pm', label: 'Golden PM', value: eveningGolden },
      { key: 'sunset', label: 'Sunset', value: sunset },
    ]
  }, [sun])

  const sliderMinutes = useMemo(() => hhmmToMinutes(timeInput) ?? 12 * 60, [timeInput])

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionHead}>SUN PLANNER</Text>
      <Text style={styles.sub}>
        Plan natural light by location, day, and time. Sunrise/sunset from Open-Meteo, sun angles are approximate.
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
      {plannerView !== 'shadow' ? (
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
            {sliderNativeAvailable ? (
              <Slider
                minimumValue={0}
                maximumValue={1439}
                step={1}
                value={sliderMinutes}
                onValueChange={(v) => setTimeInput(minutesToHHmm(v))}
                minimumTrackTintColor="#FFDC00"
                maximumTrackTintColor="rgba(255,255,255,0.18)"
                thumbTintColor="#FFDC00"
              />
            ) : (
              <Text style={styles.timeSliderFallback}>
                The slider activates after a new iOS build. Until then, use the - / + buttons.
              </Text>
            )}
          </View>
        </>
      ) : null}
      <TouchableOpacity style={[styles.btn, loading && styles.dim]} onPress={loadSun} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Loading…' : 'Load sun data'}</Text>
      </TouchableOpacity>

      <View style={styles.presetsRow}>
        {presetTimes.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[styles.presetBtn, (!p.value || loading) && styles.presetBtnDisabled]}
            disabled={!p.value || loading}
            onPress={() => {
              if (p.value) setTimeInput(p.value)
            }}
          >
            <Text style={styles.presetBtnLabel}>{p.label}</Text>
            <Text style={styles.presetBtnValue}>{p.value ?? '—'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.err}>{error}</Text> : null}
      {label ? <Text style={styles.location}>{label}</Text> : null}

      {sun ? (
        <View style={styles.card}>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Sunrise</Text>
            <Text style={styles.metricValue}>{fmtClock(sun.sunrise)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Sunset</Text>
            <Text style={styles.metricValue}>{fmtClock(sun.sunset)}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Daylight</Text>
            <Text style={styles.metricValue}>{daylightHours}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Golden hour (approx)</Text>
            <Text style={styles.metricValue}>
              {`${fmtClock(sun.sunrise)}–${fmtClock(new Date(new Date(sun.sunrise).getTime() + 60 * 60 * 1000).toISOString())}`}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Evening golden hour (approx)</Text>
            <Text style={styles.metricValue}>
              {`${fmtClock(new Date(new Date(sun.sunset).getTime() - 60 * 60 * 1000).toISOString())}–${fmtClock(sun.sunset)}`}
            </Text>
          </View>
        </View>
      ) : null}

      {angleData ? (
        <View style={styles.card}>
          <Text style={styles.angleHead}>Sun angle at selected time</Text>
          <Text style={styles.angleLine}>Altitude: {angleData.altitude}°</Text>
          <Text style={styles.angleLine}>
            Azimuth: {angleData.azimuth}° ({angleData.dir})
          </Text>
          {isShadowMapFeatureEnabled() && latLon && subjectLatLon ? (
            <View style={styles.viewToggleRow}>
              <TouchableOpacity
                style={[styles.viewToggleBtn, plannerView === 'metrics' && styles.viewToggleBtnOn]}
                onPress={() => setPlannerView('metrics')}
              >
                <Text style={[styles.viewToggleText, plannerView === 'metrics' && styles.viewToggleTextOn]}>Metrics</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewToggleBtn, plannerView === 'shadow' && styles.viewToggleBtnOn]}
                onPress={() => setPlannerView('shadow')}
              >
                <Text style={[styles.viewToggleText, plannerView === 'shadow' && styles.viewToggleTextOn]}>
                  Sun Planner{canShowShadowMap() ? '' : ' (setup)'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {plannerView === 'shadow' && isShadowMapFeatureEnabled() && latLon && subjectLatLon ? (
            <View style={styles.shadowMapBlock}>
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
                subjectHeightM={(() => {
                  const h = Number(subjectHeightM.replace(',', '.'))
                  return Number.isFinite(h) && h > 0 ? h : 2
                })()}
                timeLabel={timeInput}
                timeMinutes={sliderMinutes}
                onTimeMinutesChange={(minutes) => setTimeInput(minutesToHHmm(minutes))}
                onNudgeMinutes={(delta) => setTimeInput((v) => shiftHHmm(v, delta))}
                onSetNow={() => setTimeInput(nowHHmm())}
                sliderAvailable={sliderNativeAvailable}
              />
            </View>
          ) : null}

          {plannerView === 'metrics' || !isShadowMapFeatureEnabled() || !latLon || !subjectLatLon ? (
            <>
          {sunVisual ? (
            <>
              <View style={styles.visualWrap}>
                <View style={styles.compass}>
                  <Text style={[styles.compassMark, styles.markN]}>N</Text>
                  <Text style={[styles.compassMark, styles.markE]}>E</Text>
                  <Text style={[styles.compassMark, styles.markS]}>S</Text>
                  <Text style={[styles.compassMark, styles.markW]}>W</Text>
                  <View style={[styles.sunDot, { left: sunVisual.dotLeft, top: sunVisual.dotTop }]} />
                  <View style={[styles.centerDot]} />
                </View>
                <View style={styles.beamWrap}>
                  <View style={styles.beamGrid}>
                    <View style={styles.beamGridCol} />
                    <View style={styles.beamGridCol} />
                    <View style={styles.beamGridCol} />
                  </View>
                  <View style={styles.beamGridRow} />
                  <View style={[styles.beamArrow, { transform: [{ rotate: `${sunVisual.beamAngle}deg` }] }]} />
                  <View style={[styles.beamLine, { transform: [{ rotate: `${sunVisual.beamAngle}deg` }] }]} />
                  <Text style={styles.beamText}>{sunVisual.altitudeHint}</Text>
                </View>
              </View>
            </>
          ) : null}
          {dayTimeline ? (
            <View style={styles.timelineWrap}>
              <Text style={styles.timelineTitle}>Daylight timeline</Text>
              <View style={styles.timelineTrack}>
                <View style={styles.timelineDaylight} />
                <View style={[styles.timelineGolden, { left: 0, width: `${dayTimeline.morningGoldenEnd * 100}%` }]} />
                <View
                  style={[
                    styles.timelineGolden,
                    { left: `${dayTimeline.eveningGoldenStart * 100}%`, width: `${(1 - dayTimeline.eveningGoldenStart) * 100}%` },
                  ]}
                />
                <View style={[styles.timelineNow, { left: `${dayTimeline.selectedRatio * 100}%` }]} />
              </View>
              <View style={styles.timelineLabels}>
                <Text style={styles.timelineLabel}>{fmtClock(sun?.sunrise ?? '')}</Text>
                <Text style={[styles.timelineLabel, !dayTimeline.inDaylight && styles.timelineLabelWarn]}>
                  {dayTimeline.inDaylight ? 'In daylight' : 'Outside daylight'}
                </Text>
                <Text style={styles.timelineLabel}>{fmtClock(sun?.sunset ?? '')}</Text>
              </View>
            </View>
          ) : null}
          <View style={styles.shadowWrap}>
            <Text style={styles.timelineTitle}>Sun Planner preview</Text>
            <Text style={styles.shadowSub}>Approximation from sun angle + subject height (no 3D buildings yet).</Text>
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
            <View style={styles.shadowMap}>
              <View style={styles.shadowGrid}>
                <View style={styles.shadowGridV} />
                <View style={styles.shadowGridV} />
                <View style={styles.shadowGridV} />
              </View>
              <View style={[styles.shadowGridH, { top: '25%' }]} />
              <View style={[styles.shadowGridH, { top: '50%' }]} />
              <View style={[styles.shadowGridH, { top: '75%' }]} />
              <Text style={[styles.shadowMark, styles.shadowNorth]}>N</Text>
              <Text style={[styles.shadowMark, styles.shadowEast]}>E</Text>
              <Text style={[styles.shadowMark, styles.shadowSouth]}>S</Text>
              <Text style={[styles.shadowMark, styles.shadowWest]}>W</Text>
              <View style={styles.subjectDot} />
              {shadowPreview?.visible ? (
                <>
                  <View
                    style={[
                      styles.shadowLine,
                      {
                        transform: [{ rotate: `${shadowPreview.rotation}deg` }],
                        width: shadowPreview.lengthPx,
                      },
                    ]}
                  />
                  <View style={[styles.shadowTip, { left: shadowPreview.left, top: shadowPreview.top }]} />
                </>
              ) : null}
            </View>
            <Text style={styles.shadowMeta}>
              {shadowPreview?.visible && shadowPreview.lengthMeters != null
                ? `Estimated shadow length: ${shadowPreview.lengthMeters.toFixed(1)} m`
                : 'Sun below horizon - no direct cast shadow'}
            </Text>
          </View>
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
  timeSliderFallback: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginVertical: 8 },
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
  presetBtnDisabled: { opacity: 0.45 },
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
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    gap: 12,
  },
  metricLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 12, flex: 1 },
  metricValue: { color: '#FFDC00', fontSize: 13, fontWeight: '700' },
  angleHead: { color: '#fff', fontSize: 14, fontWeight: '800', marginBottom: 8 },
  angleLine: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginBottom: 3 },
  viewToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    marginBottom: 4,
  },
  viewToggleBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    backgroundColor: '#151515',
  },
  viewToggleBtnOn: { borderColor: '#FFDC00', backgroundColor: 'rgba(255,220,0,0.12)' },
  viewToggleText: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '800' },
  viewToggleTextOn: { color: '#FFDC00' },
  shadowMapBlock: { marginTop: 8 },
  visualWrap: { marginTop: 10, gap: 12 },
  compass: {
    width: 124,
    height: 124,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  compassMark: { position: 'absolute', color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: '800' },
  markN: { top: 6, left: 58 },
  markE: { top: 56, right: 8 },
  markS: { bottom: 6, left: 58 },
  markW: { top: 56, left: 8 },
  sunDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 999,
    marginLeft: -7,
    marginTop: -7,
    backgroundColor: '#FFDC00',
  },
  centerDot: {
    position: 'absolute',
    left: 58,
    top: 58,
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  beamWrap: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(32,48,67,0.3)',
    height: 72,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  beamGrid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
  beamGridCol: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  beamGridRow: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
    marginTop: -0.5,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  beamArrow: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 0,
    height: 0,
    marginLeft: -4,
    marginTop: -28,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFDC00',
  },
  beamLine: {
    position: 'absolute',
    left: -50,
    right: -50,
    height: 2,
    backgroundColor: 'rgba(255,220,0,0.7)',
  },
  beamText: { color: 'rgba(255,255,255,0.86)', fontSize: 12, textAlign: 'center', fontWeight: '700' },
  timelineWrap: { marginTop: 12 },
  timelineTitle: { color: '#fff', fontSize: 12, fontWeight: '800', marginBottom: 8 },
  timelineTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    position: 'relative',
  },
  timelineDaylight: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(55,138,221,0.26)',
  },
  timelineGolden: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,220,0,0.38)',
  },
  timelineNow: {
    position: 'absolute',
    top: -3,
    width: 2,
    height: 16,
    marginLeft: -1,
    backgroundColor: '#fff',
  },
  timelineLabels: { marginTop: 6, flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  timelineLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 11 },
  timelineLabelWarn: { color: '#ff9f9f', fontWeight: '700' },
  shadowWrap: { marginTop: 14 },
  shadowSub: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginBottom: 10 },
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
  shadowMap: {
    height: 184,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(31,48,68,0.38)',
    overflow: 'hidden',
    position: 'relative',
  },
  shadowGrid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
  shadowGridV: { width: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  shadowGridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  shadowMark: { position: 'absolute', color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '800' },
  shadowNorth: { top: 6, left: '50%', marginLeft: -4 },
  shadowEast: { right: 8, top: '50%', marginTop: -6 },
  shadowSouth: { bottom: 6, left: '50%', marginLeft: -4 },
  shadowWest: { left: 8, top: '50%', marginTop: -6 },
  subjectDot: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginLeft: -5,
    marginTop: -5,
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#FFDC00',
  },
  shadowLine: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    marginTop: -1,
    height: 2,
    backgroundColor: 'rgba(20,20,20,0.9)',
  },
  shadowTip: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 999,
    marginLeft: -4,
    marginTop: -4,
    backgroundColor: 'rgba(20,20,20,0.95)',
  },
  shadowMeta: { marginTop: 8, color: 'rgba(255,255,255,0.72)', fontSize: 12 },
})
