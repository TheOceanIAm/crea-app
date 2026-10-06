import Constants from 'expo-constants'

/**
 * Public Mapbox token (pk.*) for runtime maps (tiles + styles).
 * Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in .env.local / EAS env.
 */
export function getMapboxAccessToken(): string {
  const fromEnv = String(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '').trim()
  if (fromEnv) return fromEnv
  const extra = Constants.expoConfig?.extra as { mapboxAccessToken?: string } | undefined
  return String(extra?.mapboxAccessToken ?? '').trim()
}

/**
 * Feature gate for Sun Planner map UI. Default: on when a token exists; set EXPO_PUBLIC_SHADOWMAP_ENABLED=false to hide.
 */
export function isShadowMapFeatureEnabled(): boolean {
  const raw = process.env.EXPO_PUBLIC_SHADOWMAP_ENABLED
  if (raw === undefined || raw === '') return true
  const v = String(raw).trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function canShowShadowMap(): boolean {
  return isShadowMapFeatureEnabled() && !!getMapboxAccessToken()
}

/** CDN build for the Sun Planner web map and the native WebView. */
export const MAPBOX_GL_VERSION = 'v3.32.0'

export const MAPBOX_STANDARD_STYLE = 'mapbox://styles/mapbox/standard'

/** Basemap tweaks for the oblique sun study: 3D city, no label clutter. */
export const MAPBOX_STANDARD_BASEMAP = {
  show3dObjects: true,
  show3dBuildings: true,
  show3dTrees: true,
  show3dFacades: true,
  showPlaceLabels: false,
  showRoadLabels: false,
  showPointOfInterestLabels: false,
  showTransitLabels: false,
} as const
