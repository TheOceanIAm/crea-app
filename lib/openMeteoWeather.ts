/**
 * 7-day forecast via Open-Meteo (no API key). Non-commercial use: see https://open-meteo.com
 */

export type DailyForecastDay = {
  date: string
  tempMax: number
  tempMin: number
  precipProbMax: number | null
  code: number
  summary: string
}

export type GeocodeHit = {
  lat: number
  lon: number
  label: string
}

type OpenMeteoGeoResult = {
  name: string
  latitude: number
  longitude: number
  admin1?: string
  country?: string
}

function toGeocodeHit(r: OpenMeteoGeoResult): GeocodeHit {
  const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ')
  return { lat: r.latitude, lon: r.longitude, label }
}

async function geocodeWithOpenMeteo(query: string): Promise<GeocodeHit | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=de&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Location search failed')
  const data = (await res.json()) as { results?: OpenMeteoGeoResult[] }
  const r = data.results?.[0]
  if (!r) return null
  return toGeocodeHit(r)
}

async function geocodeWithNominatim(query: string): Promise<GeocodeHit | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
  })
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return null
  const data = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>
  const hit = data?.[0]
  if (!hit?.lat || !hit?.lon) return null
  const lat = Number(hit.lat)
  const lon = Number(hit.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return {
    lat,
    lon,
    label: String(hit.display_name ?? query),
  }
}

function buildGeocodeCandidates(query: string): string[] {
  const q = query.trim().replace(/\s+/g, ' ')
  if (!q) return []
  const out = new Set<string>([q])

  // Street + house number is often too specific for Open-Meteo.
  const noHouseNumber = q.replace(/\b\d+[a-zA-Z]?\b/g, '').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim()
  if (noHouseNumber && noHouseNumber !== q) out.add(noHouseNumber)

  const parts = q.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) out.add(parts.slice(1).join(', '))

  const postalCity = q.match(/\b\d{5}\s+[A-Za-z\u00C0-\u024F\-\s]+\b/)
  if (postalCity?.[0]) out.add(postalCity[0].trim())

  return [...out]
}

export async function suggestLocations(query: string): Promise<GeocodeHit[]> {
  const q = query.trim()
  if (q.length < 3) return []
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=de&format=json`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as { results?: OpenMeteoGeoResult[] }
  return (data.results ?? []).map(toGeocodeHit)
}

export async function geocodeLocation(query: string): Promise<GeocodeHit | null> {
  const q = query.trim()
  if (!q) return null
  const candidates = buildGeocodeCandidates(q)

  for (const c of candidates) {
    try {
      const hit = await geocodeWithOpenMeteo(c)
      if (hit) return hit
    } catch {
      // Try next candidate/fallback provider.
    }
  }

  for (const c of candidates) {
    const hit = await geocodeWithNominatim(c)
    if (hit) return hit
  }

  return null
}

export async function fetchForecast7Days(lat: number, lon: number): Promise<DailyForecastDay[]> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '7',
  })
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Could not load weather data')
  const data = (await res.json()) as {
    daily?: Record<string, unknown> & {
      time?: string[]
      weather_code?: number[]
      weathercode?: number[]
      temperature_2m_max?: number[]
      temperature_2m_min?: number[]
      precipitation_probability_max?: (number | null)[]
    }
  }
  const d = data.daily
  if (!d?.time?.length) return []

  const codes = d.weather_code ?? d.weathercode ?? []

  const out: DailyForecastDay[] = []
  for (let i = 0; i < d.time.length; i++) {
    const code = (Array.isArray(codes) ? codes[i] : undefined) ?? 0
    const tmax = d.temperature_2m_max?.[i] ?? 0
    const tmin = d.temperature_2m_min?.[i] ?? 0
    const pmax = d.precipitation_probability_max?.[i]
    out.push({
      date: d.time[i],
      tempMax: Math.round(tmax * 10) / 10,
      tempMin: Math.round(tmin * 10) / 10,
      precipProbMax: pmax != null && typeof pmax === 'number' ? Math.round(pmax) : null,
      code: typeof code === 'number' ? code : 0,
      summary: wmoWeatherSummary(typeof code === 'number' ? code : 0),
    })
  }
  return out
}

/** WMO Weather interpretation codes (Open-Meteo). */
function wmoWeatherSummary(code: number): string {
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Mainly clear / cloudy'
  if (code <= 48) return 'Fog'
  if (code <= 57) return 'Freezing drizzle / fog'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Rain showers'
  if (code <= 86) return 'Snow showers'
  if (code <= 99) return 'Thunderstorm'
  return '—'
}
