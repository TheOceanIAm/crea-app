import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import {
  MAPBOX_GL_VERSION,
  MAPBOX_STANDARD_BASEMAP,
  MAPBOX_STANDARD_STYLE,
  canShowShadowMap,
  getMapboxAccessToken,
} from '@/lib/mapboxConfig'
import {
  buildSunPlannerMapPayload,
  type ShadowRealism,
} from '@/lib/sunPlannerMapModel'
import type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

const MAPBOX_JS_URL = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.js`
const MAPBOX_CSS_URL = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.css`
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

function firstSymbolLayerId(map: any): string | undefined {
  const layers = map.getStyle()?.layers || []
  for (const layer of layers) {
    if (layer.type === 'symbol') return layer.id
  }
  return undefined
}

function applyPayload(map: any, payload: ReturnType<typeof buildSunPlannerMapPayload>) {
  const empty = { type: 'FeatureCollection', features: [] }
  const setSrc = (id: string, data: unknown) => {
    const src = map.getSource(id)
    if (src && typeof src.setData === 'function') src.setData(data || empty)
  }

  map.easeTo({
    center: payload.camera.center,
    zoom: payload.camera.zoom,
    pitch: payload.camera.pitch,
    duration: 220,
    essential: true,
  })

  applySunLight(map, payload.mapLight)

  setSrc('crea-subject', payload.subjectPoint)
  setSrc('crea-sun-direction', payload.sunDirection)
  setSrc('crea-sun-tip', payload.sunTip)
  setSrc('crea-shadow-area', payload.shadowArea)
  setSrc('crea-shadow-line', payload.shadowLine)

  if (map.getLayer('crea-shadow-penumbra')) {
    map.setPaintProperty('crea-shadow-penumbra', 'fill-opacity', payload.shadowTone.penumbraOpacity)
  }
  if (map.getLayer('crea-shadow-umbra')) {
    map.setPaintProperty('crea-shadow-umbra', 'fill-opacity', payload.shadowTone.umbraOpacity)
  }
  if (map.getLayer('crea-shadow-line-soft')) {
    map.setPaintProperty('crea-shadow-line-soft', 'line-opacity', payload.shadowTone.lineOpacity * 0.42)
  }
  if (map.getLayer('crea-shadow-line-core')) {
    map.setPaintProperty('crea-shadow-line-core', 'line-opacity', payload.shadowTone.lineOpacity)
  }
}

function applySunLight(map: any, mapLight: { position: [number, number, number]; intensity: number }) {
  if (typeof map.setLights !== 'function' || !mapLight?.position) return
  const azimuth = Number(mapLight.position[1]) || 0
  const polar = Math.max(0, Math.min(90, Number(mapLight.position[2]) || 45))
  const sunUp = polar < 89
  const directional = sunUp ? 1 : 0.08
  try {
    map.setLights([
      {
        id: 'crea-ambient',
        type: 'ambient',
        properties: { color: 'rgb(210,220,232)', intensity: sunUp ? 0.22 : 0.18 },
      },
      {
        id: 'crea-sun',
        type: 'directional',
        properties: {
          color: 'rgb(255,232,180)',
          intensity: directional,
          direction: [azimuth, polar],
          'cast-shadows': sunUp,
          'shadow-intensity': sunUp ? 1 : 0,
        },
      },
    ])
  } catch {
    // Older GL builds without the lights API keep the style preset.
  }
}

function ensureMapLayers(map: any) {
  const before = firstSymbolLayerId(map)
  const empty = { type: 'FeatureCollection', features: [] }

  if (!map.getSource('crea-shadow-area')) {
    map.addSource('crea-shadow-area', { type: 'geojson', data: empty })
    map.addLayer(
      {
        id: 'crea-shadow-penumbra',
        type: 'fill',
        source: 'crea-shadow-area',
        filter: ['==', ['get', 'kind'], 'penumbra'],
        paint: {
          'fill-color': 'rgba(20,20,20,0.22)',
          'fill-opacity': 0.12,
          'fill-emissive-strength': 0.65,
        },
      },
      before
    )
    map.addLayer(
      {
        id: 'crea-shadow-umbra',
        type: 'fill',
        source: 'crea-shadow-area',
        filter: ['==', ['get', 'kind'], 'umbra'],
        paint: {
          'fill-color': 'rgba(10,10,10,0.4)',
          'fill-opacity': 0.2,
          'fill-emissive-strength': 0.65,
        },
      },
      before
    )
  }

  if (!map.getSource('crea-shadow-line')) {
    map.addSource('crea-shadow-line', { type: 'geojson', data: empty })
    map.addLayer(
      {
        id: 'crea-shadow-line-soft',
        type: 'line',
        source: 'crea-shadow-line',
        paint: {
          'line-color': 'rgba(10,10,10,0.35)',
          'line-width': 10,
          'line-opacity': 0.2,
          'line-blur': 2.5,
          'line-emissive-strength': 0.7,
        },
      },
      before
    )
    map.addLayer(
      {
        id: 'crea-shadow-line-core',
        type: 'line',
        source: 'crea-shadow-line',
        paint: {
          'line-color': 'rgba(10,10,10,0.7)',
          'line-width': 3.5,
          'line-opacity': 0.35,
          'line-blur': 0.6,
          'line-emissive-strength': 0.7,
        },
      },
      before
    )
  }

  if (!map.getSource('crea-sun-direction')) {
    map.addSource('crea-sun-direction', { type: 'geojson', data: empty })
    map.addLayer({
      id: 'crea-sun-direction-soft',
      type: 'line',
      source: 'crea-sun-direction',
      paint: {
        'line-color': 'rgba(255,220,0,0.42)',
        'line-width': 8,
        'line-opacity': 0.5,
        'line-blur': 1.5,
        'line-emissive-strength': 1,
      },
    })
    map.addLayer({
      id: 'crea-sun-direction-core',
      type: 'line',
      source: 'crea-sun-direction',
      paint: {
        'line-color': '#FFDC00',
        'line-width': 3,
        'line-opacity': 0.95,
        'line-emissive-strength': 1,
      },
    })
  }

  if (!map.getSource('crea-sun-tip')) {
    map.addSource('crea-sun-tip', { type: 'geojson', data: empty })
    map.addLayer({
      id: 'crea-sun-tip-circle',
      type: 'circle',
      source: 'crea-sun-tip',
      paint: {
        'circle-radius': 5,
        'circle-color': '#FFDC00',
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#0a0a0a',
        'circle-emissive-strength': 1,
      },
    })
  }

  if (!map.getSource('crea-subject')) {
    map.addSource('crea-subject', { type: 'geojson', data: empty })
    map.addLayer({
      id: 'crea-subject-circle',
      type: 'circle',
      source: 'crea-subject',
      paint: {
        'circle-radius': 9,
        'circle-color': '#FFDC00',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#0a0a0a',
        'circle-emissive-strength': 1,
      },
    })
  }
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
  const [realism, setRealism] = useState<ShadowRealism>('subtle')

  const payload = useMemo(
    () =>
      buildSunPlannerMapPayload({
        subject,
        sunAzimuthDeg,
        sunAltitudeDeg,
        subjectHeightM,
        realism,
      }),
    [subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM, realism]
  )

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
          style: MAPBOX_STANDARD_STYLE,
          config: { basemap: { ...MAPBOX_STANDARD_BASEMAP } },
          center: payload.camera.center,
          zoom: payload.camera.zoom,
          pitch: payload.camera.pitch,
          bearing: 0,
          antialias: true,
        })
        mapRef.current = map
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

        map.on('click', (e: any) => {
          const lat = Number(e?.lngLat?.lat)
          const lon = Number(e?.lngLat?.lng)
          if (Number.isFinite(lat) && Number.isFinite(lon)) onSubjectChange(lat, lon)
        })

        map.on('load', () => {
          ensureMapLayers(map)
          applyPayload(map, payload)
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
    // Intentionally mount once; updates flow through the second effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, onSubjectChange])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded?.()) return
    ensureMapLayers(map)
    applyPayload(map, payload)
  }, [payload])

  if (!ready || !token) {
    return (
      <View style={styles.wrapper}>
        <Text style={styles.hint}>Sun Planner map needs EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN.</Text>
      </View>
    )
  }

  return (
    <View style={styles.wrapper}>
      <Text style={styles.hint}>
        Tap the map to place the subject. Buildings and trees cast shadows from the selected time.
      </Text>
      <View style={styles.realismRow}>
        {(['subtle', 'balanced', 'strong'] as const).map((key) => (
          <TouchableOpacity
            key={key}
            style={[styles.realismBtn, realism === key && styles.realismBtnOn]}
            onPress={() => setRealism(key)}
          >
            <Text style={[styles.realismText, realism === key && styles.realismTextOn]}>
              {key[0].toUpperCase() + key.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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

      <Text style={styles.metaHint}>Mapbox GL JS (same engine as native WebView).</Text>
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
  realismRow: { flexDirection: 'row', gap: 8 },
  realismBtn: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: '#141414',
    paddingVertical: 7,
    alignItems: 'center',
  },
  realismBtnOn: { borderColor: '#FFDC00', backgroundColor: 'rgba(255,220,0,0.12)' },
  realismText: { color: 'rgba(255,255,255,0.74)', fontSize: 11, fontWeight: '700' },
  realismTextOn: { color: '#FFDC00' },
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
