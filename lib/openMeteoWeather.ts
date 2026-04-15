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

export async function geocodeLocation(query: string): Promise<GeocodeHit | null> {
  const q = query.trim()
  if (!q) return null
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Location search failed')
  const data = (await res.json()) as {
    results?: { name: string; latitude: number; longitude: number; admin1?: string; country?: string }[]
  }
  const r = data.results?.[0]
  if (!r) return null
  const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ')
  return { lat: r.latitude, lon: r.longitude, label }
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
