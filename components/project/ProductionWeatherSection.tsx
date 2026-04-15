import { useCallback, useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import { geocodeLocation, fetchForecast7Days, type DailyForecastDay } from '@/lib/openMeteoWeather'

type Props = {
  /** Prefills the search field (e.g. project location). */
  initialLocation?: string | null
}

export function ProductionWeatherSection({ initialLocation }: Props) {
  const [weatherQuery, setWeatherQuery] = useState('')
  const [weatherLabel, setWeatherLabel] = useState<string | null>(null)
  const [weatherDays, setWeatherDays] = useState<DailyForecastDay[]>([])
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError] = useState<string | null>(null)

  useEffect(() => {
    setWeatherQuery((prev) => (prev.trim() ? prev : initialLocation?.trim() ?? ''))
  }, [initialLocation])

  const loadWeather = useCallback(async () => {
    const q = weatherQuery.trim()
    if (!q) {
      Alert.alert('Weather', 'Enter a place (e.g. city or “Berlin, DE”).')
      return
    }
    setWeatherLoading(true)
    setWeatherError(null)
    try {
      const geo = await geocodeLocation(q)
      if (!geo) {
        setWeatherLabel(null)
        setWeatherDays([])
        setWeatherError('Place not found. Check spelling and try again.')
        return
      }
      const days = await fetchForecast7Days(geo.lat, geo.lon)
      setWeatherLabel(geo.label)
      setWeatherDays(days)
    } catch (e) {
      setWeatherLabel(null)
      setWeatherDays([])
      setWeatherError(e instanceof Error ? e.message : 'Could not load weather.')
    } finally {
      setWeatherLoading(false)
    }
  }, [weatherQuery])

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionHead}>WEATHER (7 DAYS)</Text>
      <Text style={styles.weatherSub}>
        Enter the shoot location — forecast via Open-Meteo (no API key).
      </Text>
      <View style={styles.weatherRow}>
        <TextInput
          style={styles.weatherInput}
          placeholder="e.g. Berlin, London, New York…"
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={weatherQuery}
          onChangeText={setWeatherQuery}
          onSubmitEditing={loadWeather}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={[styles.weatherBtn, weatherLoading && styles.dim]}
          onPress={loadWeather}
          disabled={weatherLoading}
        >
          <Text style={styles.weatherBtnText}>{weatherLoading ? '…' : 'Load'}</Text>
        </TouchableOpacity>
      </View>
      {weatherError ? <Text style={styles.weatherErr}>{weatherError}</Text> : null}
      {weatherLabel ? (
        <Text style={styles.weatherResolved} numberOfLines={2}>
          {weatherLabel}
        </Text>
      ) : null}
      {weatherDays.length > 0 ? (
        <View style={styles.weatherTable}>
          <View style={styles.weatherHeadRow}>
            <Text style={[styles.weatherColHint, styles.weatherColTag]}>Day</Text>
            <Text style={[styles.weatherColHint, styles.weatherColTemp]}>high / low</Text>
            <Text style={[styles.weatherColHint, styles.weatherColRain]}>rain</Text>
          </View>
          {weatherDays.map((day) => (
            <View key={day.date} style={styles.weatherDayRow}>
              <View style={styles.weatherDayLeft}>
                <Text style={styles.weatherDate}>
                  {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </Text>
                <Text style={styles.weatherSummary} numberOfLines={2}>
                  {day.summary}
                </Text>
              </View>
              <Text style={[styles.weatherTemps, styles.weatherColTemp]}>
                {day.tempMax}° / {day.tempMin}°
              </Text>
              <Text style={[styles.weatherRain, styles.weatherColRain]}>
                {day.precipProbMax != null ? `${day.precipProbMax}%` : '—'}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {weatherDays.length > 0 ? <Text style={styles.weatherAttr}>Data: Open-Meteo</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  sectionHead: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 2,
    marginBottom: 12,
  },
  weatherSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.38)',
    lineHeight: 17,
    marginBottom: 12,
  },
  weatherRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' },
  weatherInput: {
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
  weatherBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#378ADD',
    minWidth: 88,
    alignItems: 'center',
  },
  weatherBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  dim: { opacity: 0.55 },
  weatherErr: { fontSize: 13, color: 'rgba(255,100,100,0.9)', marginBottom: 8 },
  weatherResolved: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 10,
  },
  weatherTable: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    marginBottom: 8,
    backgroundColor: '#111',
  },
  weatherHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  weatherDayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  weatherDayLeft: { flex: 1, minWidth: 0 },
  weatherDate: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.92)' },
  weatherSummary: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  weatherTemps: { fontSize: 13, fontWeight: '600', color: '#FFDC00' },
  weatherRain: { fontSize: 12, color: 'rgba(255,255,255,0.55)' },
  weatherColHint: { fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 0.5 },
  weatherColTag: { flex: 1 },
  weatherColTemp: { width: 86, textAlign: 'right' },
  weatherColRain: { width: 48, textAlign: 'right' },
  weatherAttr: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.25)',
    marginBottom: 12,
  },
})
