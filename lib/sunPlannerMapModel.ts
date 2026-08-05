import {
  destinationLatLon,
  shadowAreaFeatures,
  shadowLineFeature,
  type LatLon,
} from '@/lib/shadowGeometry'

export type ShadowRealism = 'subtle' | 'balanced' | 'strong'

type FeatureCollection = {
  type: 'FeatureCollection'
  features: Array<Record<string, unknown>>
}

export type SunPlannerMapPayload = {
  subject: LatLon
  sunAzimuthDeg: number
  sunAltitudeDeg: number
  subjectHeightM: number
  realism: ShadowRealism
  subjectPoint: FeatureCollection
  sunDirection: FeatureCollection
  sunTip: FeatureCollection
  shadowArea: FeatureCollection
  shadowLine: FeatureCollection
  shadowTone: {
    penumbraOpacity: number
    umbraOpacity: number
    lineOpacity: number
  }
  buildingShadow: {
    visible: boolean
    translate: [number, number]
    opacity: number
  }
  mapLight: {
    anchor: 'map'
    position: [number, number, number]
    intensity: number
  }
  camera: {
    center: [number, number]
    zoom: number
    pitch: number
  }
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

function realismScale(realism: ShadowRealism): number {
  if (realism === 'subtle') return 0.72
  if (realism === 'strong') return 1.12
  return 0.92
}

function sunLineLengthM(realism: ShadowRealism): number {
  if (realism === 'subtle') return 70
  if (realism === 'strong') return 120
  return 95
}

/** Shared paint + GeoJSON payload for native WebView and web Mapbox GL JS. */
export function buildSunPlannerMapPayload(input: {
  subject: LatLon
  sunAzimuthDeg: number
  sunAltitudeDeg: number
  subjectHeightM: number
  realism: ShadowRealism
}): SunPlannerMapPayload {
  const { subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM, realism } = input
  const scale = realismScale(realism)

  const shadowLine = shadowLineFeature(subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM, {
    maxShadowMeters: 500,
  })
  const shadowArea = shadowAreaFeatures(subject, sunAzimuthDeg, sunAltitudeDeg, subjectHeightM, {
    maxShadowMeters: 500,
  })

  const altitude = Math.max(0, sunAltitudeDeg)
  const t = Math.max(0, Math.min(1, altitude / 70))
  // Softer than the old native stack — avoid heavy black slabs at low sun.
  const shadowTone = {
    penumbraOpacity: (0.08 + (1 - t) * 0.16) * scale,
    umbraOpacity: (0.14 + (1 - t) * 0.22) * scale,
    lineOpacity: (0.18 + (1 - t) * 0.4) * scale,
  }

  // Hide fake building footprints when the sun is at/below horizon (was the worst-looking case).
  const sunUp = sunAltitudeDeg > 0.5
  const altitudeForOffset = Math.max(1, sunAltitudeDeg)
  const shadowBearing = ((sunAzimuthDeg + 180) % 360 + 360) % 360
  const r = (shadowBearing * Math.PI) / 180
  const baseOffsetPx = Math.max(4, Math.min(28, 180 / altitudeForOffset))
  const buildingOpacity = sunUp
    ? Math.max(0.06, Math.min(0.18, (0.28 - altitudeForOffset / 140) * scale))
    : 0

  const tipLen = sunLineLengthM(realism)
  const tip = destinationLatLon(subject, sunAzimuthDeg, tipLen)

  const subjectPoint: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [subject.lon, subject.lat] },
      },
    ],
  }

  const sunDirection: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [subject.lon, subject.lat],
            [tip.lon, tip.lat],
          ],
        },
      },
    ],
  }

  const sunTip: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [tip.lon, tip.lat] },
      },
    ],
  }

  const polar = 90 - Math.max(0, Math.min(85, sunAltitudeDeg))

  return {
    subject,
    sunAzimuthDeg,
    sunAltitudeDeg,
    subjectHeightM,
    realism,
    subjectPoint,
    sunDirection,
    sunTip,
    shadowArea: (shadowArea as FeatureCollection) ?? EMPTY_FC,
    shadowLine: shadowLine
      ? ({ type: 'FeatureCollection', features: [shadowLine] } as FeatureCollection)
      : EMPTY_FC,
    shadowTone,
    buildingShadow: {
      visible: sunUp && buildingOpacity > 0.02,
      translate: [Math.sin(r) * baseOffsetPx, -Math.cos(r) * baseOffsetPx],
      opacity: buildingOpacity,
    },
    mapLight: {
      anchor: 'map',
      position: [1.35, sunAzimuthDeg, polar],
      intensity: Math.max(0.35, Math.min(0.85, 0.35 + shadowTone.lineOpacity * 0.55)),
    },
    camera: {
      center: [subject.lon, subject.lat],
      zoom: 17,
      pitch: 55,
    },
  }
}
