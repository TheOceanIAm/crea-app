import React, { useEffect, useMemo, useRef } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { canShowShadowMap, getMapboxAccessToken } from '@/lib/mapboxConfig'
import { destinationLatLon, shadowAreaFeatures, shadowLineFeature } from '@/lib/shadowGeometry'
import type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

const MAPBOX_JS_URL = 'https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.js'
const MAPBOX_CSS_URL = 'https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css'
const MAP_HEIGHT = 320

let mapboxLoadPromise: Promise<void> | null = null

function ensureMapboxGlLoaded(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const w = window as unknown as { mapboxgl?: unknown; __creaMapboxReady?: boolean }
  if (w.mapboxgl && w.__creaMapboxReady) return Promise.resolve()
  if (mapboxLoadPromise) return mapboxLoadPromise

  mapboxLoadPromise = new Promise((resolve, reject) => {
    const existingCss = document.querySelector(`link[data-crea-mapbox="1"]`)
    if (!existingCss) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = MAPBOX_CSS_URL
      link.setAttribute('data-crea-mapbox', '1')
      document.head.appendChild(link)
    }

    const existingScript = document.querySelector(`script[data-crea-mapbox="1"]`) as HTMLScriptElement | null
    if (existingScript) {
      if (w.mapboxgl) {
        w.__creaMapboxReady = true
        resolve()
      } else {
        existingScript.addEventListener('load', () => {
          w.__creaMapboxReady = true
          resolve()
        })
        existingScript.addEventListener('error', () => reject(new Error('Mapbox GL script failed to load')))
      }
      return
    }

    const script = document.createElement('script')
    script.src = MAPBOX_JS_URL
    script.async = true
    script.defer = true
    script.setAttribute('data-crea-mapbox', '1')
    script.onload = () => {
      w.__creaMapboxReady = true
      resolve()
    }
    script.onerror = () => reject(new Error('Mapbox GL script failed to load'))
    document.body.appendChild(script)
  })

  return mapboxLoadPromise
}

export function ProductionShadowMapSection({
  subject,
  onSubjectChange,
  onResetSubject,
  sunAzimuthDeg,
  sunAltitudeDeg,
  subjectHeightM,
  timeLabel,
  timeMinutes,
  onTimeMinutesChange,
  onNudgeMinutes,
  onSetNow,
}: ProductionShadowMapSectionProps) {
  const mapElRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const token = getMapboxAccessToken()
  const ready = canShowShadowMap()

  const shadowLine = useMemo(
    () =>
      shadowLineFeature(subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM, {
        maxShadowMeters: 500,
      }),
    [subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM]
  )

  const shadowArea = useMemo(
    () =>
      shadowAreaFeatures(subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM, {
        maxShadowMeters: 500,
      }),
    [subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM]
  )

  const subjectPoint = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Point' as const,
            coordinates: [subject.lon, subject.lat] as [number, number],
          },
        },
      ],
    }),
    [subject.lat, subject.lon]
  )

  const sunDirection = useMemo(() => {
    const tip = destinationLatLon(subject, sunAzimuthDeg, 95)
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [subject.lon, subject.lat],
              [tip.lon, tip.lat],
            ] as [number, number][],
          },
        },
      ],
    }
  }, [subject.lat, subject.lon, sunAzimuthDeg])

  useEffect(() => {
    if (!ready || !token || !mapElRef.current) return
    let cancelled = false

    void ensureMapboxGlLoaded()
      .then(() => {
        if (cancelled || !mapElRef.current) return
        const mapboxgl = (window as any).mapboxgl
        if (!mapboxgl || mapRef.current) return

        mapboxgl.accessToken = token
        const map = new mapboxgl.Map({
          container: mapElRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [subject.lon, subject.lat],
          zoom: 16.5,
          pitch: 45,
          bearing: 0,
        })
        mapRef.current = map
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

        map.on('click', (e: any) => {
          const lat = Number(e?.lngLat?.lat)
          const lon = Number(e?.lngLat?.lng)
          if (Number.isFinite(lat) && Number.isFinite(lon)) onSubjectChange(lat, lon)
        })

        map.on('load', () => {
          map.addSource('crea-subject', { type: 'geojson', data: subjectPoint })
          map.addLayer({
            id: 'crea-subject-circle',
            type: 'circle',
            source: 'crea-subject',
            paint: {
              'circle-radius': 8,
              'circle-color': '#FFDC00',
              'circle-stroke-width': 2,
              'circle-stroke-color': '#0a0a0a',
            },
          })

          map.addSource('crea-sun-direction', { type: 'geojson', data: sunDirection })
          map.addLayer({
            id: 'crea-sun-direction-line',
            type: 'line',
            source: 'crea-sun-direction',
            paint: {
              'line-color': '#FFDC00',
              'line-width': 3,
              'line-opacity': 0.9,
            },
          })

          map.addSource('crea-shadow-area', {
            type: 'geojson',
            data: shadowArea ?? { type: 'FeatureCollection', features: [] },
          })
          map.addLayer({
            id: 'crea-shadow-penumbra',
            type: 'fill',
            source: 'crea-shadow-area',
            filter: ['==', ['get', 'kind'], 'penumbra'],
            paint: { 'fill-color': 'rgba(20,20,20,0.35)', 'fill-opacity': 0.28 },
          })
          map.addLayer({
            id: 'crea-shadow-umbra',
            type: 'fill',
            source: 'crea-shadow-area',
            filter: ['==', ['get', 'kind'], 'umbra'],
            paint: { 'fill-color': 'rgba(10,10,10,0.65)', 'fill-opacity': 0.42 },
          })

          map.addSource('crea-shadow-line', {
            type: 'geojson',
            data:
              shadowLine ?? ({
                type: 'FeatureCollection',
                features: [],
              } as const),
          })
          map.addLayer({
            id: 'crea-shadow-line-layer',
            type: 'line',
            source: 'crea-shadow-line',
            paint: {
              'line-color': 'rgba(10,10,10,0.9)',
              'line-width': 4,
              'line-opacity': 0.75,
            },
          })
        })
      })
      .catch(() => {
        // Leave fallback message rendered below.
      })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [ready, token, onSubjectChange, subject.lat, subject.lon, shadowArea, shadowLine, subjectPoint, sunDirection])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    map.easeTo({
      center: [subject.lon, subject.lat],
      duration: 220,
      essential: true,
    })

    const subjectSrc = map.getSource('crea-subject')
    if (subjectSrc && typeof subjectSrc.setData === 'function') subjectSrc.setData(subjectPoint)

    const sunSrc = map.getSource('crea-sun-direction')
    if (sunSrc && typeof sunSrc.setData === 'function') sunSrc.setData(sunDirection)

    const areaSrc = map.getSource('crea-shadow-area')
    if (areaSrc && typeof areaSrc.setData === 'function') {
      areaSrc.setData(shadowArea ?? { type: 'FeatureCollection', features: [] })
    }

    const lineSrc = map.getSource('crea-shadow-line')
    if (lineSrc && typeof lineSrc.setData === 'function') {
      lineSrc.setData(shadowLine ?? { type: 'FeatureCollection', features: [] })
    }
  }, [subject.lat, subject.lon, subjectPoint, sunDirection, shadowArea, shadowLine])

  if (!ready || !token) {
    return (
      <View style={styles.wrapper}>
        <Text style={styles.hint}>Sun Planner map needs EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN.</Text>
      </View>
    )
  }

  return (
    <View style={styles.wrapper}>
      <Text style={styles.hint}>Tap map to place subject. Shadow preview is approximated on flat ground.</Text>

      <View style={styles.mapShell}>
        <div ref={mapElRef} style={{ width: '100%', height: '100%' }} />
      </View>

      <View style={styles.timeOverlay}>
        <View style={styles.timeHead}>
          <Text style={styles.timeLabel}>Time scrub</Text>
          <Text style={styles.timeValue}>{timeLabel}</Text>
        </View>
        <View style={styles.timeStepRow}>
          <TouchableOpacity style={styles.timeStepBtn} onPress={() => onNudgeMinutes(-30)}>
            <Text style={styles.timeStepText}>-30m</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.timeStepBtn} onPress={() => onNudgeMinutes(-15)}>
            <Text style={styles.timeStepText}>-15m</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.timeStepBtn} onPress={onSetNow}>
            <Text style={styles.timeStepText}>Now</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.timeStepBtn} onPress={() => onNudgeMinutes(15)}>
            <Text style={styles.timeStepText}>+15m</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.timeStepBtn} onPress={() => onNudgeMinutes(30)}>
            <Text style={styles.timeStepText}>+30m</Text>
          </TouchableOpacity>
        </View>
        <input
          type="range"
          min={0}
          max={1439}
          step={1}
          value={timeMinutes}
          onChange={(e) => onTimeMinutesChange(Number(e.currentTarget.value))}
          style={styles.timeRange as unknown as React.CSSProperties}
        />
      </View>

      <Text style={styles.metaHint}>Web map is active (bundler-safe CDN integration).</Text>
      <TouchableOpacity style={styles.resetBtn} onPress={onResetSubject}>
        <Text style={styles.resetText}>Reset subject to location</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 6, gap: 8 },
  hint: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    lineHeight: 15,
  },
  mapShell: {
    width: '100%',
    height: MAP_HEIGHT,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#111',
  },
  metaHint: { color: 'rgba(255,255,255,0.52)', fontSize: 11, marginTop: 8 },
  timeOverlay: {
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(10,10,10,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  timeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  timeLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700' },
  timeValue: { color: '#FFDC00', fontSize: 12, fontWeight: '800' },
  timeStepRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  timeStepBtn: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(22,22,22,0.82)',
    paddingVertical: 5,
    alignItems: 'center',
  },
  timeStepText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  timeRange: { width: '100%' },
  resetBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  resetText: { color: '#FFDC00', fontWeight: '800', fontSize: 12 },
})
