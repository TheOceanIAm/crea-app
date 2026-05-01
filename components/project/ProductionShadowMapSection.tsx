import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import Slider from '@react-native-community/slider'
import { getMapboxAccessToken, canShowShadowMap } from '@/lib/mapboxConfig'
import { destinationLatLon, shadowAreaFeatures, shadowLineFeature } from '@/lib/shadowGeometry'
import type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

export type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

const MAP_HEIGHT = 280
type NativeMapboxModule = {
  default: { setAccessToken: (token: string) => void; StyleURL: { Street: string } }
  MapView: React.ComponentType<Record<string, unknown>>
  Camera: React.ComponentType<Record<string, unknown>>
  Light: React.ComponentType<Record<string, unknown>>
  ShapeSource: React.ComponentType<Record<string, unknown>>
  FillLayer: React.ComponentType<Record<string, unknown>>
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
  timeLabel,
  timeMinutes,
  onTimeMinutesChange,
  onNudgeMinutes,
  onSetNow,
  sliderAvailable,
}: ProductionShadowMapSectionProps) {
  const token = getMapboxAccessToken()
  const ready = canShowShadowMap()
  const [mapError, setMapError] = useState<string | null>(null)
  const [nativeUnavailable, setNativeUnavailable] = useState(false)
  const [realism, setRealism] = useState<'subtle' | 'balanced' | 'strong'>('balanced')

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
      anchor: 'map',
      position: [1.35, sunAzimuthDeg, polar],
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
  const Light = nativeMapbox.Light
  const ShapeSource = nativeMapbox.ShapeSource
  const FillLayer = nativeMapbox.FillLayer
  const LineLayer = nativeMapbox.LineLayer
  const CircleLayer = nativeMapbox.CircleLayer
  const VectorSource = nativeMapbox.VectorSource
  const FillExtrusionLayer = nativeMapbox.FillExtrusionLayer

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
      {mapError ? <Text style={styles.mapErr}>{mapError}</Text> : null}
      <View style={styles.mapShell}>
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
          <Light style={mapLight} />
          <Camera
            centerCoordinate={[subject.lon, subject.lat]}
            zoomLevel={17}
            pitch={55}
            heading={0}
            animationMode="flyTo"
            animationDuration={220}
            triggerKey={`${subject.lat.toFixed(5)}-${subject.lon.toFixed(5)}`}
            minZoomLevel={8}
            maxZoomLevel={19}
          />
          <VectorSource id="mapbox-streets-buildings" url="mapbox://mapbox.mapbox-streets-v8">
            <FillLayer
              id="crea-building-shadow-layer-near"
              sourceLayerID="building"
              filter={['==', ['get', 'extrude'], 'true']}
              style={{
                fillColor: 'rgba(0,0,0,0.9)',
                fillOpacity: buildingShadow.nearOpacity,
                fillTranslate: buildingShadow.nearTranslate,
                fillTranslateAnchor: 'map',
              }}
            />
            <FillLayer
              id="crea-building-shadow-layer-mid"
              sourceLayerID="building"
              filter={['==', ['get', 'extrude'], 'true']}
              style={{
                fillColor: 'rgba(0,0,0,0.9)',
                fillOpacity: buildingShadow.midOpacity,
                fillTranslate: buildingShadow.midTranslate,
                fillTranslateAnchor: 'map',
              }}
            />
            <FillLayer
              id="crea-building-shadow-layer-far"
              sourceLayerID="building"
              filter={['==', ['get', 'extrude'], 'true']}
              style={{
                fillColor: 'rgba(0,0,0,0.9)',
                fillOpacity: buildingShadow.farOpacity,
                fillTranslate: buildingShadow.farTranslate,
                fillTranslateAnchor: 'map',
              }}
            />
            <FillExtrusionLayer
              id="crea-3d-buildings"
              sourceLayerID="building"
              filter={['==', ['get', 'extrude'], 'true']}
              style={{
                fillExtrusionColor: '#e6e8ec',
                fillExtrusionOpacity: 0.92,
                fillExtrusionHeight: ['coalesce', ['get', 'render_height'], ['get', 'height'], 12],
                fillExtrusionBase: ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
              }}
            />
          </VectorSource>
          {shadowAreaShape ? (
            <ShapeSource id="shadow-area" shape={shadowAreaShape}>
              <FillLayer
                id="shadow-penumbra-layer"
                filter={['==', ['get', 'kind'], 'penumbra']}
                style={{
                  fillColor: 'rgba(20,20,20,0.3)',
                  fillOpacity: shadowTone.penumbraOpacity,
                }}
              />
              <FillLayer
                id="shadow-umbra-layer"
                filter={['==', ['get', 'kind'], 'umbra']}
                style={{
                  fillColor: 'rgba(10,10,10,0.62)',
                  fillOpacity: shadowTone.umbraOpacity,
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
          <ShapeSource id="sun-direction-line" shape={sunDirectionLineFeature}>
            <LineLayer
              id="sun-direction-line-soft"
              style={{
                lineColor: 'rgba(255,220,0,0.42)',
                lineWidth: 8,
                lineOpacity: 0.5,
              }}
            />
            <LineLayer
              id="sun-direction-line-core"
              style={{
                lineColor: '#FFDC00',
                lineWidth: 3,
                lineOpacity: 0.95,
              }}
            />
          </ShapeSource>
          <ShapeSource id="sun-direction-tip" shape={sunDirectionTipFeature}>
            <CircleLayer
              id="sun-direction-tip-circle"
              style={{
                circleRadius: 5,
                circleColor: '#FFDC00',
                circleStrokeWidth: 1.5,
                circleStrokeColor: '#0a0a0a',
              }}
            />
          </ShapeSource>
          {shadowShape ? (
            <ShapeSource id="shadow-line" shape={shadowShape}>
              <LineLayer
                id="shadow-line-soft"
                style={{
                  lineColor: 'rgba(10,10,10,0.45)',
                  lineWidth: 12,
                  lineOpacity: shadowTone.lineOpacity * 0.42,
                }}
              />
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
          {sliderAvailable ? (
            <Slider
              minimumValue={0}
              maximumValue={1439}
              step={1}
              value={timeMinutes}
              onValueChange={onTimeMinutesChange}
              minimumTrackTintColor="#FFDC00"
              maximumTrackTintColor="rgba(255,255,255,0.22)"
              thumbTintColor="#FFDC00"
            />
          ) : (
            <Text style={styles.timeFallback}>Slider wird nach einem neuen iOS build aktiv.</Text>
          )}
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
  mapErr: { color: '#ff9b9b', fontSize: 12, marginBottom: 6 },
  mapShell: { position: 'relative' },
  map: { width: '100%', borderRadius: 12, overflow: 'hidden' },
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
  timeStepRow: { flexDirection: 'row', gap: 6, marginBottom: 4 },
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
  timeFallback: { color: 'rgba(255,255,255,0.68)', fontSize: 10, marginTop: 2 },
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
