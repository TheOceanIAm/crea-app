import 'mapbox-gl/dist/mapbox-gl.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import Map, { Layer, NavigationControl, Source, type MapRef } from 'react-map-gl/mapbox'
import { getMapboxAccessToken, canShowShadowMap } from '@/lib/mapboxConfig'
import { destinationLatLon, shadowAreaFeatures, shadowLineFeature } from '@/lib/shadowGeometry'
import type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

const MAP_HEIGHT = 280

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
  sliderAvailable,
}: ProductionShadowMapSectionProps) {
  const token = getMapboxAccessToken()
  const ready = canShowShadowMap()
  const [realism, setRealism] = useState<'subtle' | 'balanced' | 'strong'>('balanced')

  const [viewState, setViewState] = useState(() => ({
    longitude: subject.lon,
    latitude: subject.lat,
    zoom: 17,
    pitch: 55,
    bearing: 0,
  }))
  const mapRef = useRef<MapRef>(null)
  const moveThrottle = useRef(0)

  useEffect(() => {
    setViewState((vs) => ({
      ...vs,
      longitude: subject.lon,
      latitude: subject.lat,
    }))
  }, [subject.lat, subject.lon])

  const shadowShape = useMemo(
    () =>
      shadowLineFeature(subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM, {
        maxShadowMeters: 500,
      }),
    [subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM]
  )
  const shadowAreaShape = useMemo(
    () =>
      shadowAreaFeatures(subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM, {
        maxShadowMeters: 500,
      }),
    [subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM]
  )
  const shadowTone = useMemo(() => {
    const altitude = Math.max(0, sunAltitudeDeg)
    const t = Math.max(0, Math.min(1, altitude / 70))
    return {
      penumbraOpacity: 0.12 + (1 - t) * 0.24,
      umbraOpacity: 0.24 + (1 - t) * 0.38,
      lineOpacity: 0.28 + (1 - t) * 0.62,
    }
  }, [sunAltitudeDeg])
  const realismScale = realism === 'subtle' ? 0.78 : realism === 'strong' ? 1.22 : 1
  const buildingShadow = useMemo(() => {
    const altitude = Math.max(1, sunAltitudeDeg)
    const shadowBearing = ((sunAzimuthDeg + 180) % 360 + 360) % 360
    const r = (shadowBearing * Math.PI) / 180
    const baseOffsetPx = Math.max(5, Math.min(38, 260 / altitude))
    const nearOpacity = Math.max(0.14, Math.min(0.36, (0.46 - altitude / 110) * realismScale))
    const midOpacity = nearOpacity * 0.62
    const farOpacity = nearOpacity * 0.34
    return {
      nearTranslate: [Math.sin(r) * baseOffsetPx * 0.72, -Math.cos(r) * baseOffsetPx * 0.72] as [number, number],
      midTranslate: [Math.sin(r) * baseOffsetPx * 1.08, -Math.cos(r) * baseOffsetPx * 1.08] as [number, number],
      farTranslate: [Math.sin(r) * baseOffsetPx * 1.5, -Math.cos(r) * baseOffsetPx * 1.5] as [number, number],
      nearOpacity,
      midOpacity,
      farOpacity,
    }
  }, [sunAzimuthDeg, sunAltitudeDeg, realismScale])
  const mapLight = useMemo(() => {
    const altitude = Math.max(0, Math.min(85, sunAltitudeDeg))
    const polar = 90 - altitude
    return {
      anchor: 'map' as const,
      position: [1.35, sunAzimuthDeg, polar] as [number, number, number],
      color: '#fff7d9',
      intensity: Math.max(0.35, Math.min(0.92, 0.35 + shadowTone.lineOpacity * 0.6)),
    }
  }, [sunAzimuthDeg, sunAltitudeDeg, shadowTone.lineOpacity])

  const subjectFeature = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Point' as const,
        coordinates: [subject.lon, subject.lat] as [number, number],
      },
    }),
    [subject.lat, subject.lon]
  )
  const sunDirectionLineFeature = useMemo(() => {
    const length = realism === 'subtle' ? 70 : realism === 'strong' ? 120 : 95
    const tip = destinationLatLon(subject, sunAzimuthDeg, length)
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [subject.lon, subject.lat] as [number, number],
          [tip.lon, tip.lat] as [number, number],
        ],
      },
    }
  }, [subject.lat, subject.lon, sunAzimuthDeg, realism])
  const sunDirectionTipFeature = useMemo(() => {
    const length = realism === 'subtle' ? 70 : realism === 'strong' ? 120 : 95
    const tip = destinationLatLon(subject, sunAzimuthDeg, length)
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Point' as const,
        coordinates: [tip.lon, tip.lat] as [number, number],
      },
    }
  }, [subject.lat, subject.lon, sunAzimuthDeg, realism])

  const onMapClick = useCallback(
    (e: { lngLat?: { lat: number; lng: number } | null }) => {
      const ll = e.lngLat
      if (!ll) return
      onSubjectChange(ll.lat, ll.lng)
    },
    [onSubjectChange]
  )

  if (!ready) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Sun Planner</Text>
        <Text style={styles.fallbackText}>
          Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN (public pk token) to load Mapbox 3D buildings and shadow
          direction on web.
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.wrapper}>
      <Text style={styles.hint}>Tap map to place subject. Shadow is a flat-ground estimate (not real mesh).</Text>
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
      <View style={[styles.mapShell, { height: MAP_HEIGHT }]}>
        <Map
          ref={mapRef}
          {...viewState}
          onMove={(evt) => {
            const now = Date.now()
            if (now - moveThrottle.current < 40) return
            moveThrottle.current = now
            setViewState(evt.viewState)
          }}
          mapboxAccessToken={token}
          mapStyle="mapbox://styles/mapbox/streets-v11"
          light={mapLight}
          style={{ width: '100%', height: '100%' }}
          maxZoom={19}
          minZoom={8}
          reuseMaps
          onClick={onMapClick}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <Source id="mapbox-streets-buildings" type="vector" url="mapbox://mapbox.mapbox-streets-v8">
            <Layer
              id="crea-building-shadow-layer-near"
              type="fill"
              source-layer="building"
              filter={['==', ['get', 'extrude'], 'true']}
              paint={{
                'fill-color': 'rgba(0,0,0,0.9)',
                'fill-opacity': buildingShadow.nearOpacity,
                'fill-translate': buildingShadow.nearTranslate,
                'fill-translate-anchor': 'map',
              }}
            />
            <Layer
              id="crea-building-shadow-layer-mid"
              type="fill"
              source-layer="building"
              filter={['==', ['get', 'extrude'], 'true']}
              paint={{
                'fill-color': 'rgba(0,0,0,0.9)',
                'fill-opacity': buildingShadow.midOpacity,
                'fill-translate': buildingShadow.midTranslate,
                'fill-translate-anchor': 'map',
              }}
            />
            <Layer
              id="crea-building-shadow-layer-far"
              type="fill"
              source-layer="building"
              filter={['==', ['get', 'extrude'], 'true']}
              paint={{
                'fill-color': 'rgba(0,0,0,0.9)',
                'fill-opacity': buildingShadow.farOpacity,
                'fill-translate': buildingShadow.farTranslate,
                'fill-translate-anchor': 'map',
              }}
            />
            <Layer
              id="crea-3d-buildings"
              type="fill-extrusion"
              source-layer="building"
              minzoom={14}
              filter={['==', ['get', 'extrude'], 'true']}
              paint={{
                'fill-extrusion-color': '#e6e8ec',
                'fill-extrusion-opacity': 0.92,
                'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
                'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
              }}
            />
          </Source>
          {shadowAreaShape ? (
            <Source id="shadow-area" type="geojson" data={shadowAreaShape}>
              <Layer
                id="shadow-penumbra-layer"
                type="fill"
                filter={['==', ['get', 'kind'], 'penumbra']}
                paint={{
                  'fill-color': 'rgba(20,20,20,0.34)',
                  'fill-opacity': shadowTone.penumbraOpacity,
                }}
              />
              <Layer
                id="shadow-umbra-layer"
                type="fill"
                filter={['==', ['get', 'kind'], 'umbra']}
                paint={{
                  'fill-color': 'rgba(10,10,10,0.62)',
                  'fill-opacity': shadowTone.umbraOpacity,
                }}
              />
            </Source>
          ) : null}
          <Source id="subject-pt" type="geojson" data={subjectFeature}>
            <Layer
              id="subject-circle"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': '#FFDC00',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#0a0a0a',
              }}
            />
          </Source>
          <Source id="sun-direction-line" type="geojson" data={sunDirectionLineFeature}>
            <Layer
              id="sun-direction-line-soft"
              type="line"
              paint={{
                'line-color': 'rgba(255,220,0,0.42)',
                'line-width': 8,
                'line-opacity': 0.5,
              }}
            />
            <Layer
              id="sun-direction-line-core"
              type="line"
              paint={{
                'line-color': '#FFDC00',
                'line-width': 3,
                'line-opacity': 0.95,
              }}
            />
          </Source>
          <Source id="sun-direction-tip" type="geojson" data={sunDirectionTipFeature}>
            <Layer
              id="sun-direction-tip-circle"
              type="circle"
              paint={{
                'circle-radius': 5,
                'circle-color': '#FFDC00',
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#0a0a0a',
              }}
            />
          </Source>
          {shadowShape ? (
            <Source id="shadow-line" type="geojson" data={shadowShape}>
              <Layer
                id="shadow-line-soft"
                type="line"
                paint={{
                  'line-color': 'rgba(10,10,10,0.45)',
                  'line-width': 12,
                  'line-opacity': shadowTone.lineOpacity * 0.42,
                }}
              />
              <Layer
                id="shadow-line-layer"
                type="line"
                paint={{
                  'line-color': 'rgba(10,10,10,0.92)',
                  'line-width': 5,
                  'line-opacity': shadowTone.lineOpacity,
                }}
              />
            </Source>
          ) : null}
        </Map>
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
          {!sliderAvailable ? <Text style={styles.timeFallback}>Web slider aktiv (native build nicht verlinkt).</Text> : null}
        </View>
      </View>
      <Text style={styles.metaHint}>Dark area = estimated shadow footprint. Yellow line = sun direction.</Text>
      <TouchableOpacity style={styles.resetBtn} onPress={onResetSubject}>
        <Text style={styles.resetText}>Reset subject to location</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { marginTop: 6 },
  hint: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 8,
  },
  realismRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
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
  metaHint: { color: 'rgba(255,255,255,0.52)', fontSize: 11, marginTop: 8 },
  mapShell: { width: '100%', borderRadius: 12, overflow: 'hidden', position: 'relative' },
  timeOverlay: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
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
  timeFallback: { color: 'rgba(255,255,255,0.68)', fontSize: 10, marginTop: 2 },
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
  fallback: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111',
  },
  fallbackTitle: { color: '#fff', fontWeight: '800', fontSize: 14, marginBottom: 6 },
  fallbackText: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 17 },
})
