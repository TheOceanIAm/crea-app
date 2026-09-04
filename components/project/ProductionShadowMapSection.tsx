import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NativeModules, UIManager, View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native'
import Slider from '@react-native-community/slider'
import { getMapboxAccessToken, canShowShadowMap } from '@/lib/mapboxConfig'
import { buildSunPlannerMapHtml } from '@/lib/sunPlannerMapHtml'
import {
  buildSunPlannerMapPayload,
  type ShadowRealism,
} from '@/lib/sunPlannerMapModel'
import type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

export type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

const MAP_HEIGHT = 280

type WebViewMessageEvent = { nativeEvent: { data: string } }
type NativeWebViewComponent = React.ComponentType<{
  ref?: React.Ref<{ injectJavaScript: (js: string) => void } | null>
  originWhitelist?: string[]
  source?: { html: string; baseUrl?: string }
  style?: object | object[]
  onMessage?: (event: WebViewMessageEvent) => void
  onLoadStart?: () => void
  onLoadEnd?: () => void
  onError?: () => void
  onHttpError?: () => void
  javaScriptEnabled?: boolean
  domStorageEnabled?: boolean
  allowFileAccess?: boolean
  mixedContentMode?: string
  setSupportMultipleWindows?: boolean
  scrollEnabled?: boolean
  bounces?: boolean
  overScrollMode?: string
  nestedScrollEnabled?: boolean
  androidLayerType?: string
}>

function loadNativeWebView(): NativeWebViewComponent | null {
  try {
    const natives = NativeModules as Record<string, unknown>
    const hasNative =
      !!natives.RNCWebView ||
      !!natives.RNCWebViewModule ||
      !!UIManager.getViewManagerConfig?.('RNCWebView') ||
      !!UIManager.getViewManagerConfig?.('RNCWebViewModule')
    if (!hasNative) return null
    // Only require JS after the native binary is confirmed — otherwise TurboModuleRegistry throws.
    return require('react-native-webview').WebView as NativeWebViewComponent
  } catch {
    return null
  }
}

const WebView = loadNativeWebView()

function injectJson(fnName: string, value: unknown): string {
  // JSON is safe inside a single-quoted JS string when we escape quotes/newlines via stringify twice.
  return `window.${fnName} && window.${fnName}(${JSON.stringify(value)}); true;`
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
  const webRef = useRef<{ injectJavaScript: (js: string) => void } | null>(null)
  const mapReadyRef = useRef(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [realism, setRealism] = useState<ShadowRealism>('subtle')

  const html = useMemo(() => buildSunPlannerMapHtml(), [])
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

  const bootMap = useCallback(() => {
    if (!token || !webRef.current) return
    webRef.current.injectJavaScript(
      injectJson('__creaBoot', {
        token,
        state: payload,
      })
    )
  }, [token, payload])

  const pushUpdate = useCallback(() => {
    if (!mapReadyRef.current || !webRef.current) return
    webRef.current.injectJavaScript(injectJson('__creaUpdate', payload))
  }, [payload])

  useEffect(() => {
    pushUpdate()
  }, [pushUpdate])

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let data: { type?: string; lat?: number; lon?: number; message?: string } | null = null
      try {
        data = JSON.parse(event.nativeEvent.data)
      } catch {
        return
      }
      if (!data?.type) return

      if (data.type === 'script-ready') {
        bootMap()
        return
      }
      if (data.type === 'ready') {
        mapReadyRef.current = true
        setMapError(null)
        pushUpdate()
        return
      }
      if (data.type === 'subject') {
        const lat = Number(data.lat)
        const lon = Number(data.lon)
        if (Number.isFinite(lat) && Number.isFinite(lon)) onSubjectChange(lat, lon)
        return
      }
      if (data.type === 'error') {
        setMapError(data.message || 'Map failed to load')
      }
    },
    [bootMap, onSubjectChange, pushUpdate]
  )

  if (!WebView) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Sun Planner</Text>
        <Text style={styles.fallbackText}>
          The shadow map needs a current iOS build with WebView. Shot list, call sheet, crew and sun metrics still work.
        </Text>
      </View>
    )
  }

  if (!ready || !token) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Sun Planner</Text>
        <Text style={styles.fallbackText}>
          Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN (public pk token) to load the Mapbox GL JS shadow map.
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
      {mapError ? <Text style={styles.mapErr}>{mapError}</Text> : null}
      <View style={styles.mapShell}>
        <WebView
          ref={webRef}
          originWhitelist={['*']}
          source={{ html, baseUrl: 'https://api.mapbox.com' }}
          style={[styles.map, { height: MAP_HEIGHT }]}
          onMessage={onMessage}
          onLoadStart={() => {
            mapReadyRef.current = false
          }}
          onLoadEnd={() => {
            // iOS sometimes finishes load before inline script posts script-ready.
            bootMap()
          }}
          onError={() => setMapError('Map WebView failed to load.')}
          onHttpError={() => setMapError('Map WebView HTTP error.')}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          nestedScrollEnabled
          androidLayerType={Platform.OS === 'android' ? 'hardware' : undefined}
        />
        <View style={styles.timeOverlay} pointerEvents="box-none">
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
            <Text style={styles.timeFallback}>The slider activates after a new iOS build.</Text>
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
  mapShell: {
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#111',
  },
  map: { width: '100%', backgroundColor: '#111' },
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
