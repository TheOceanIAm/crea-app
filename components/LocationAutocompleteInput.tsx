import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  View,
} from 'react-native'

type LocationAutocompleteInputProps = {
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  inputStyle?: StyleProp<TextStyle>
}

type OpenMeteoResult = {
  name?: string
  admin1?: string
  country?: string
}

function formatSuggestion(item: OpenMeteoResult): string | null {
  const name = String(item.name ?? '').trim()
  const admin1 = String(item.admin1 ?? '').trim()
  const country = String(item.country ?? '').trim()
  if (!name) return null
  if (admin1 && country) return `${name}, ${admin1}, ${country}`
  if (country) return `${name}, ${country}`
  return name
}

export function LocationAutocompleteInput({
  value,
  onChangeText,
  placeholder = 'Start typing a city...',
  inputStyle,
}: LocationAutocompleteInputProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const requestIdRef = useRef(0)

  useEffect(() => {
    const query = value.trim()
    if (query.length < 2) {
      setSuggestions([])
      setLoading(false)
      return
    }

    const reqId = requestIdRef.current + 1
    requestIdRef.current = reqId
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`
        const res = await fetch(url)
        const json = (await res.json()) as { results?: OpenMeteoResult[] }
        if (requestIdRef.current !== reqId) return
        const next = Array.isArray(json.results)
          ? json.results
              .map(formatSuggestion)
              .filter((x): x is string => !!x)
              .filter((x, i, arr) => arr.indexOf(x) === i)
              .slice(0, 6)
          : []
        setSuggestions(next)
      } catch {
        if (requestIdRef.current === reqId) setSuggestions([])
      } finally {
        if (requestIdRef.current === reqId) setLoading(false)
      }
    }, 320)

    return () => clearTimeout(timer)
  }, [value])

  const showList = open && (loading || suggestions.length > 0)
  const mergedInputStyle = useMemo(() => [styles.input, inputStyle], [inputStyle])

  return (
    <View>
      <TextInput
        style={mergedInputStyle}
        value={value}
        onChangeText={(next) => {
          onChangeText(next)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.28)"
      />
      {showList ? (
        <View style={styles.dropdown}>
          {loading && suggestions.length === 0 ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#FFDC00" size="small" />
              <Text style={styles.loadingText}>Searching locations...</Text>
            </View>
          ) : null}
          {suggestions.map((item) => (
            <Pressable
              key={item}
              style={styles.item}
              onPress={() => {
                onChangeText(item)
                setOpen(false)
                setSuggestions([])
              }}
            >
              <Text style={styles.itemText}>{item}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    color: '#fff',
    fontSize: 15,
  },
  dropdown: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#141414',
    overflow: 'hidden',
    marginBottom: 16,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
  },
  item: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  itemText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
  },
})
