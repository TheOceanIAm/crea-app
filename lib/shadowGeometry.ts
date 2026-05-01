export type LatLon = { lat: number; lon: number }

/** Bearing of shadow cast on ground (degrees, clockwise from north). */
export function shadowBearingDeg(sunAzimuthDeg: number): number {
  return ((sunAzimuthDeg + 180) % 360 + 360) % 360
}

/** Simple stick-shadow length on flat ground (meters). */
export function shadowLengthMeters(subjectHeightM: number, sunAltitudeDeg: number): number | null {
  const h = subjectHeightM
  if (!Number.isFinite(h) || h <= 0) return null
  if (!Number.isFinite(sunAltitudeDeg) || sunAltitudeDeg <= 0) return null
  const rad = (sunAltitudeDeg * Math.PI) / 180
  return h / Math.tan(rad)
}

const EARTH_RADIUS_M = 6371000

/** Destination point given start, bearing (deg clockwise from N), distance (m). */
export function destinationLatLon(from: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const δ = distanceM / EARTH_RADIUS_M
  const θ = (bearingDeg * Math.PI) / 180
  const φ1 = (from.lat * Math.PI) / 180
  const λ1 = (from.lon * Math.PI) / 180
  const sinφ1 = Math.sin(φ1)
  const cosφ1 = Math.cos(φ1)
  const sinδ = Math.sin(δ)
  const cosδ = Math.cos(δ)
  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ)
  const φ2 = Math.asin(sinφ2)
  const y = Math.sin(θ) * sinδ * cosφ1
  const x = cosδ - sinφ1 * sinφ2
  const λ2 = λ1 + Math.atan2(y, x)
  let lon = (λ2 * 180) / Math.PI
  lon = ((lon + 540) % 360) - 180
  return { lat: (φ2 * 180) / Math.PI, lon }
}

export type ShadowLineOptions = {
  /** Cap shadow line length on map (meters) for readability / perf */
  maxShadowMeters?: number
}

export type ShadowLineFeature = {
  type: 'Feature'
  properties: { lengthMeters: number; cappedMeters: number }
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

export type ShadowPolygonFeature = {
  type: 'Feature'
  properties: {
    lengthMeters: number
    cappedMeters: number
    widthMeters: number
    kind: 'umbra' | 'penumbra'
  }
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
}

export type ShadowAreaFeatureCollection = {
  type: 'FeatureCollection'
  features: ShadowPolygonFeature[]
}

/** GeoJSON LineString from subject toward shadow tip (lon, lat order for Mapbox). */
export function shadowLineFeature(
  subject: LatLon,
  sunAzimuthDeg: number,
  sunAltitudeDeg: number,
  subjectHeightM: number,
  options?: ShadowLineOptions
): ShadowLineFeature | null {
  const len = shadowLengthMeters(subjectHeightM, sunAltitudeDeg)
  if (len == null) return null
  const cap = options?.maxShadowMeters ?? 450
  const dist = Math.min(len, cap)
  const bearing = shadowBearingDeg(sunAzimuthDeg)
  const end = destinationLatLon(subject, bearing, dist)
  return {
    type: 'Feature',
    properties: { lengthMeters: len, cappedMeters: dist },
    geometry: {
      type: 'LineString',
      coordinates: [
        [subject.lon, subject.lat],
        [end.lon, end.lat],
      ],
    },
  }
}

/** Simple elongated polygon to preview affected shadow area on flat ground. */
export function shadowPolygonFeature(
  subject: LatLon,
  sunAzimuthDeg: number,
  sunAltitudeDeg: number,
  subjectHeightM: number,
  options?: ShadowLineOptions & { widthMeters?: number }
): ShadowPolygonFeature | null {
  const len = shadowLengthMeters(subjectHeightM, sunAltitudeDeg)
  if (len == null) return null
  const cap = options?.maxShadowMeters ?? 450
  const dist = Math.min(len, cap)
  const widthMeters = Math.max(0.5, options?.widthMeters ?? Math.max(1.2, subjectHeightM * 0.55))
  const bearing = shadowBearingDeg(sunAzimuthDeg)
  const perp = (bearing + 90) % 360
  const halfW = widthMeters / 2

  const startLeft = destinationLatLon(subject, perp, halfW)
  const startRight = destinationLatLon(subject, perp + 180, halfW)
  const tip = destinationLatLon(subject, bearing, dist)
  const tipLeft = destinationLatLon(tip, perp, halfW * 0.55)
  const tipRight = destinationLatLon(tip, perp + 180, halfW * 0.55)

  return {
    type: 'Feature',
    properties: { lengthMeters: len, cappedMeters: dist, widthMeters, kind: 'umbra' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [startLeft.lon, startLeft.lat],
          [tipLeft.lon, tipLeft.lat],
          [tipRight.lon, tipRight.lat],
          [startRight.lon, startRight.lat],
          [startLeft.lon, startLeft.lat],
        ],
      ],
    },
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function makeShadowPolygon(
  subject: LatLon,
  bearing: number,
  lengthMeters: number,
  startWidthMeters: number,
  endWidthMeters: number,
  properties: ShadowPolygonFeature['properties']
): ShadowPolygonFeature {
  const perp = (bearing + 90) % 360
  const startHalf = startWidthMeters / 2
  const endHalf = endWidthMeters / 2
  const tip = destinationLatLon(subject, bearing, lengthMeters)
  const startLeft = destinationLatLon(subject, perp, startHalf)
  const startRight = destinationLatLon(subject, perp + 180, startHalf)
  const tipLeft = destinationLatLon(tip, perp, endHalf)
  const tipRight = destinationLatLon(tip, perp + 180, endHalf)
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [startLeft.lon, startLeft.lat],
          [tipLeft.lon, tipLeft.lat],
          [tipRight.lon, tipRight.lat],
          [startRight.lon, startRight.lat],
          [startLeft.lon, startLeft.lat],
        ],
      ],
    },
  }
}

/**
 * More realistic shadow-area approximation:
 * - inner umbra (darker, narrower, slightly shorter)
 * - outer penumbra (softer, wider, slightly longer)
 */
export function shadowAreaFeatures(
  subject: LatLon,
  sunAzimuthDeg: number,
  sunAltitudeDeg: number,
  subjectHeightM: number,
  options?: ShadowLineOptions & { widthMeters?: number }
): ShadowAreaFeatureCollection | null {
  const len = shadowLengthMeters(subjectHeightM, sunAltitudeDeg)
  if (len == null) return null
  const cap = options?.maxShadowMeters ?? 450
  const dist = Math.min(len, cap)
  const baseWidth = Math.max(0.8, options?.widthMeters ?? subjectHeightM * 0.45)
  const bearing = shadowBearingDeg(sunAzimuthDeg)

  // Lower sun => broader/longer penumbra and stronger contrast.
  const altitudeNorm = clamp(sunAltitudeDeg / 70, 0, 1)
  const softness = 1 - altitudeNorm

  const umbraLen = dist * (0.7 + 0.08 * altitudeNorm)
  const penumbraLen = dist * (1.0 + 0.2 * softness)
  const umbraEndW = baseWidth * (0.25 + 0.15 * altitudeNorm)
  const penumbraEndW = baseWidth * (0.9 + 1.0 * softness)

  const umbra = makeShadowPolygon(subject, bearing, umbraLen, baseWidth, umbraEndW, {
    lengthMeters: len,
    cappedMeters: umbraLen,
    widthMeters: baseWidth,
    kind: 'umbra',
  })
  const penumbra = makeShadowPolygon(subject, bearing, penumbraLen, baseWidth * 1.15, penumbraEndW, {
    lengthMeters: len,
    cappedMeters: penumbraLen,
    widthMeters: baseWidth * 1.15,
    kind: 'penumbra',
  })

  return {
    type: 'FeatureCollection',
    features: [penumbra, umbra],
  }
}
