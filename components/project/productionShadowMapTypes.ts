import type { LatLon } from '@/lib/shadowGeometry'

export type ProductionShadowMapSectionProps = {
  center: LatLon
  subject: LatLon
  onSubjectChange: (lat: number, lon: number) => void
  onResetSubject: () => void
  sunAzimuthDeg: number
  sunAltitudeDeg: number
  subjectHeightM: number
}
