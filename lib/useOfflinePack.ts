import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import {
  deleteOfflinePack,
  downloadOfflinePack,
  getOfflinePackMeta,
  setPreferOfflinePack,
  shouldPreferOfflinePack,
  subscribeOfflinePack,
  type OfflinePackMeta,
} from '@/lib/offlinePack'
import { maybeSilentRefreshPack, probePackFreshness, type PackFreshness } from '@/lib/offlinePackSync'
import { pendingShotStatusCount } from '@/lib/offlineShotOutbox'

export function useOfflinePack(
  projectId: string,
  projectTitle: string,
  jobId?: string | null,
  shootDates?: string[],
  projectLocation?: string | null
) {
  const [meta, setMeta] = useState<OfflinePackMeta | null>(null)
  const [busy, setBusy] = useState(false)
  const [silentUpdating, setSilentUpdating] = useState(false)
  const [freshness, setFreshness] = useState<PackFreshness | null>(null)
  const [pendingStatuses, setPendingStatuses] = useState(0)
  const [preferPack, setPreferPack] = useState(() => shouldPreferOfflinePack(projectId))
  const silentOnce = useRef(false)

  const refresh = useCallback(async () => {
    setMeta(await getOfflinePackMeta(projectId))
    setPreferPack(shouldPreferOfflinePack(projectId))
    setPendingStatuses(await pendingShotStatusCount(projectId))
    const fresh = await probePackFreshness(projectId)
    setFreshness(fresh)
  }, [projectId])

  useEffect(() => {
    void refresh()
    return subscribeOfflinePack((id) => {
      if (id === projectId) void refresh()
    })
  }, [projectId, refresh])

  useEffect(() => {
    if (silentOnce.current) return
    silentOnce.current = true
    void (async () => {
      const existing = await getOfflinePackMeta(projectId)
      if (!existing || shouldPreferOfflinePack(projectId)) return
      setSilentUpdating(true)
      await maybeSilentRefreshPack({
        projectId,
        projectTitle,
        jobId,
        shootDates,
        projectLocation,
      })
      setSilentUpdating(false)
      await refresh()
    })()
  }, [jobId, projectId, projectLocation, projectTitle, refresh, shootDates])

  const download = useCallback(async () => {
    if (busy) return
    setBusy(true)
    const result = await downloadOfflinePack({
      projectId,
      projectTitle,
      jobId,
      shootDates,
      projectLocation,
    })
    setBusy(false)
    if (result.ok === false) {
      Alert.alert('Download', result.error)
      return
    }
    setMeta(result.meta)
    setFreshness(await probePackFreshness(projectId))
  }, [busy, jobId, projectId, projectLocation, projectTitle, shootDates])

  const remove = useCallback(() => {
    Alert.alert('Remove offline copy', 'Delete the downloaded shot list, call sheet, crew and milestones from this device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy(true)
            await deleteOfflinePack(projectId)
            setBusy(false)
          })()
        },
      },
    ])
  }, [projectId])

  const viewCopy = useCallback(() => {
    setPreferOfflinePack(projectId, true)
  }, [projectId])

  const backToLive = useCallback(() => {
    setPreferOfflinePack(projectId, false)
  }, [projectId])

  return {
    meta,
    busy,
    silentUpdating,
    freshness,
    pendingStatuses,
    preferPack,
    download,
    remove,
    viewCopy,
    backToLive,
    refresh,
  }
}
