import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { getMapboxAccessToken, canShowShadowMap } from '@/lib/mapboxConfig'
import { shadowLineFeature, shadowPolygonFeature } from '@/lib/shadowGeometry'
import type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

export type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

const MAP_HEIGHT = 280
type NativeMapboxModule = {
  default: { setAccessToken: (token: string) => void; StyleURL: { Street: string } }
  MapView: React.ComponentType<Record<string, unknown>>
  Camera: React.ComponentType<Record<string, unknown>>
  ShapeSource: React.ComponentType<Record<string, unknown>>
  LineLayer: React.ComponentType<Record<string, unknown>>
  CircleLayer: React.ComponentType<Record<string, unknown>>
  VectorSource: React.ComponentType<Record<string, unknown>>
  FillExtrusionLayer: React.ComponentType<Record<string, unknown>>
}

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
  const [mapError, setMapError] = useState<string | null>(null)
  const [nativeUnavailable, setNativeUnavailable] = useState(false)

  const nativeMapbox = useMemo<NativeMapboxModule | null>(() => {
    try {
      return require('@rnmapbox/maps') as NativeMapboxModule
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (!nativeMapbox) setNativeUnavailable(true)
  }, [nativeMapbox])

  useEffect(() => {
    if (token && nativeMapbox?.default?.setAccessToken) nativeMapbox.default.setAccessToken(token)
  }, [token, nativeMapbox])

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

  const onPress = useCallback(
    (feature: { geometry?: { coordinates?: number[] } }) => {
      const c = feature.geometry?.coordinates
      if (c && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
        onSubjectChange(c[1], c[0])
      }
    },
    [onSubjectChange]
  )

  if (!ready) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Sun Planner</Text>
        <Text style={styles.fallbackText}>
          Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN (public pk token) to load Mapbox 3D buildings and shadow
          direction. Native builds also need MAPBOX_DOWNLOADS_TOKEN for prebuild (see .env.example).
        </Text>
      </View>
    )
  }

  if (!nativeMapbox || nativeUnavailable) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Sun Planner unavailable in this build</Text>
        <Text style={styles.fallbackText}>
          @rnmapbox/maps needs native linking. Start with a Dev Client / prebuild (`expo run:ios` or `expo
          run:android`) instead of Expo Go.
        </Text>
      </View>
    )
  }

  const MapView = nativeMapbox.MapView
  const Camera = nativeMapbox.Camera
  const ShapeSource = nativeMapbox.ShapeSource
  const LineLayer = nativeMapbox.LineLayer
  const CircleLayer = nativeMapbox.CircleLayer
  const VectorSource = nativeMapbox.VectorSource
  const FillExtrusionLayer = nativeMapbox.FillExtrusionLayer

  return (
    <View style={styles.wrapper}>
      <Text style={styles.hint}>Tap map to place subject. Shadow is a flat-ground estimate (not real mesh).</Text>
      {mapError ? <Text style={styles.mapErr}>{mapError}</Text> : null}
      <MapView
        style={[styles.map, { height: MAP_HEIGHT }]}
        styleURL={nativeMapbox.default.StyleURL.Street}
        scaleBarEnabled={false}
        logoEnabled
        attributionEnabled
        onPress={onPress}
        onMapLoadingError={() => setMapError('Map failed to load (check token / network).')}
        onDidFinishLoadingMap={() => setMapError(null)}
      >
        <Camera
          centerCoordinate={[subject.lon, subject.lat]}
          zoomLevel={17}
          pitch={55}
          heading={0}
          animationMode="flyTo"
          animationDuration={220}
          triggerKey={`${subject.lat.toFixed(5)}-${subject.lon.toFixed(5)}`}
          minZoomLevel={14}
          maxZoomLevel={19}
        />
        <VectorSource id="mapbox-streets-buildings" url="mapbox://mapbox.mapbox-streets-v8">
          <FillExtrusionLayer
            id="crea-3d-buildings"
            sourceLayerID="building"
            filter={['==', ['get', 'extrude'], 'true']}
            style={{
              fillExtrusionColor: '#9aa3b2',
              fillExtrusionOpacity: 0.72,
              fillExtrusionHeight: ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
              fillExtrusionBase: ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
            }}
          />
        </VectorSource>
        {shadowAreaShape ? (
          <ShapeSource id="shadow-area" shape={shadowAreaShape}>
            <FillExtrusionLayer
              id="shadow-area-layer"
              style={{
                fillExtrusionColor: 'rgba(20,20,20,0.34)',
                fillExtrusionHeight: 0.3,
                fillExtrusionBase: 0,
                fillExtrusionOpacity: shadowTone.areaOpacity,
              }}
            />
          </ShapeSource>
        ) : null}
        <ShapeSource id="subject-pt" shape={subjectFeature}>
          <CircleLayer
            id="subject-circle"
            style={{
              circleRadius: 9,
              circleColor: '#FFDC00',
              circleStrokeWidth: 2,
              circleStrokeColor: '#0a0a0a',
            }}
          />
        </ShapeSource>
        {shadowShape ? (
          <ShapeSource id="shadow-line" shape={shadowShape}>
            <LineLayer
              id="shadow-line-layer"
              style={{
                lineColor: 'rgba(10,10,10,0.92)',
                lineWidth: 5,
                lineOpacity: shadowTone.lineOpacity,
              }}
            />
          </ShapeSource>
        ) : null}
      </MapView>
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
  mapErr: { color: '#ff9b9b', fontSize: 12, marginBottom: 6 },
  map: { width: '100%', borderRadius: 12, overflow: 'hidden' },
  metaHint: { color: 'rgba(255,255,255,0.52)', fontSize: 11, marginTop: 8 },
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
