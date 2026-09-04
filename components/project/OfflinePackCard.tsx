import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Download, WifiOff } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { formatOfflinePackStamp } from '@/lib/offlinePack'
import { useOfflinePack } from '@/lib/useOfflinePack'

type Props = {
  projectId: string
  projectTitle: string
  jobId?: string | null
  shootDates?: string[]
  projectLocation?: string | null
}

export function OfflinePackCard({ projectId, projectTitle, jobId, shootDates, projectLocation }: Props) {
  const { meta, busy, silentUpdating, freshness, pendingStatuses, preferPack, download, remove, viewCopy, backToLive } =
    useOfflinePack(projectId, projectTitle, jobId, shootDates, projectLocation)

  const dayCount = meta?.shootDates.length ?? 0
  const dayLabel = dayCount === 1 ? '1 shoot day' : `${dayCount} shoot days`
  const pdfLabel =
    meta?.pdfDays && meta.pdfDays > 0 ? ` · ${meta.pdfDays} PDF${meta.pdfDays === 1 ? '' : 's'}` : ''
  const changeLabel =
    freshness && freshness.changes > 0
      ? `${freshness.changes} change${freshness.changes === 1 ? '' : 's'} online`
      : null
  const soonLabel =
    freshness?.shootSoonLabel === 'today'
      ? 'Shoot day today — update before set'
      : freshness?.shootSoonLabel === 'tomorrow'
        ? 'Shoot day tomorrow — update before set'
        : null

  let sub = 'Shot list, call sheet, crew and milestones — use on set without Wi‑Fi.'
  if (meta) {
    const stamp = `${formatOfflinePackStamp(meta.downloadedAt)} · ${dayLabel}${pdfLabel}`
    if (silentUpdating) sub = `Updating… · ${stamp}`
    else if (soonLabel && changeLabel) sub = `${soonLabel} · ${changeLabel}`
    else if (soonLabel) sub = `${soonLabel} · pack is current`
    else if (changeLabel) sub = `${stamp} · ${changeLabel}`
    else sub = `${stamp} · up to date`
    if (pendingStatuses > 0) {
      sub += ` · ${pendingStatuses} shot status${pendingStatuses === 1 ? '' : 'es'} waiting to sync`
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.iconWrap}>
          {meta ? (
            <WifiOff size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
          ) : (
            <Download size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
          )}
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>
            {meta ? (changeLabel ? 'Offline copy is behind' : 'Available offline') : 'Download for set'}
          </Text>
          <Text style={styles.sub}>{sub}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        {meta ? (
          <>
            <TouchableOpacity
              style={[styles.btn, changeLabel ? styles.btnAccent : styles.btnGhost, busy && styles.dim]}
              onPress={() => void download()}
              disabled={busy}
              activeOpacity={0.88}
            >
              {busy ? (
                <ActivityIndicator color={changeLabel ? '#0a0a0a' : '#FFDC00'} size="small" />
              ) : (
                <Text style={changeLabel ? styles.btnAccentText : styles.btnGhostText}>
                  {changeLabel ? 'Update now' : 'Update'}
                </Text>
              )}
            </TouchableOpacity>
            {preferPack ? (
              <TouchableOpacity style={[styles.btn, styles.btnAccent]} onPress={backToLive} activeOpacity={0.88}>
                <Text style={styles.btnAccentText}>Back to live</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.btn, styles.btnAccent]} onPress={viewCopy} activeOpacity={0.88}>
                <Text style={styles.btnAccentText}>View copy</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={remove} disabled={busy} activeOpacity={0.88}>
              <Text style={styles.btnDangerText}>Remove</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.btn, styles.btnAccent, busy && styles.dim]}
            onPress={() => void download()}
            disabled={busy}
            activeOpacity={0.88}
          >
            {busy ? (
              <ActivityIndicator color="#0a0a0a" size="small" />
            ) : (
              <Text style={styles.btnAccentText}>Download</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.22)',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 18,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(255,220,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  headText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 4 },
  sub: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnAccent: { backgroundColor: '#FFDC00' },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  btnAccentText: { color: '#0a0a0a', fontWeight: '800', fontSize: 13 },
  btnGhostText: { color: '#FFDC00', fontWeight: '700', fontSize: 13 },
  btnDangerText: { color: '#f87171', fontWeight: '700', fontSize: 13 },
  dim: { opacity: 0.55 },
})
