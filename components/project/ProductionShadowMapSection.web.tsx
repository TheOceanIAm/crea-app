import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ProductionShadowMapSectionProps } from '@/components/project/productionShadowMapTypes'

export function ProductionShadowMapSection({
  center,
  subject,
  onResetSubject,
  timeLabel,
  timeMinutes,
  onTimeMinutesChange,
  onNudgeMinutes,
  onSetNow,
  sunAzimuthDeg,
  sunAltitudeDeg,
}: ProductionShadowMapSectionProps) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.hint}>Sun Planner (web fallback): controls are available, map preview is disabled in this build.</Text>

      <View style={styles.infoCard}>
        <Text style={styles.infoLabel}>Subject</Text>
        <Text style={styles.infoValue}>
          {subject.lat.toFixed(5)}, {subject.lon.toFixed(5)}
        </Text>
        <Text style={styles.infoMeta}>
          Center {center.lat.toFixed(5)}, {center.lon.toFixed(5)}
        </Text>
        <Text style={styles.infoMeta}>
          Sun azimuth {sunAzimuthDeg.toFixed(0)}°, altitude {sunAltitudeDeg.toFixed(0)}°
        </Text>
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

      <Text style={styles.metaHint}>Web fallback active. Native app keeps the full 3D map implementation.</Text>
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
  infoCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#111',
    padding: 12,
    gap: 4,
  },
  infoLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  infoValue: { color: '#fff', fontSize: 13, fontWeight: '800' },
  infoMeta: { color: 'rgba(255,255,255,0.52)', fontSize: 11 },
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
