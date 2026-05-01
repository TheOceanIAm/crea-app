import 'mapbox-gl/dist/mapbox-gl.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import Map, { Layer, NavigationControl, Source, type MapRef } from 'react-map-gl/mapbox'
import { getMapboxAccessToken, canShowShadowMap } from '@/lib/mapboxConfig'
import { shadowLineFeature, shadowPolygonFeature } from '@/lib/shadowGeometry'
import type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

const MAP_HEIGHT = 280

export function ProductionShadowMapSection({
  subject,
  onSubjectChange,
  onResetSubject,
  sunAzimuthDeg,
  sunAltitudeDeg,
  subjectHeightM,
}: ProductionShadowMapSectionProps) {
  const token = getMapboxAccessToken()
  const ready = canShowShadowMap()

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
      shadowPolygonFeature(subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM, {
        maxShadowMeters: 500,
      }),
    [subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM]
  )
  const shadowTone = useMemo(() => {
    const altitude = Math.max(0, sunAltitudeDeg)
    const t = Math.max(0, Math.min(1, altitude / 70))
    return {
      areaOpacity: 0.18 + (1 - t) * 0.34,
      lineOpacity: 0.28 + (1 - t) * 0.62,
    }
  }, [sunAltitudeDeg])

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
          style={{ width: '100%', height: '100%' }}
          maxZoom={19}
          minZoom={14}
          reuseMaps
          onClick={onMapClick}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <Source id="mapbox-streets-buildings" type="vector" url="mapbox://mapbox.mapbox-streets-v8">
            <Layer
              id="crea-3d-buildings"
              type="fill-extrusion"
              source-layer="building"
              minzoom={14}
              filter={['==', ['get', 'extrude'], 'true']}
              paint={{
                'fill-extrusion-color': '#9aa3b2',
                'fill-extrusion-opacity': 0.72,
                'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
                'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
              }}
            />
          </Source>
          {shadowAreaShape ? (
            <Source id="shadow-area" type="geojson" data={shadowAreaShape}>
              <Layer
                id="shadow-area-layer"
                type="fill"
                paint={{
                  'fill-color': 'rgba(20,20,20,0.34)',
                  'fill-opacity': shadowTone.areaOpacity,
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
          {shadowShape ? (
            <Source id="shadow-line" type="geojson" data={shadowShape}>
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
      </View>
      <Text style={styles.metaHint}>Dark area = estimated shadow footprint for selected height/time.</Text>
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
  metaHint: { color: 'rgba(255,255,255,0.52)', fontSize: 11, marginTop: 8 },
  mapShell: { width: '100%', borderRadius: 12, overflow: 'hidden' },
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
