import { useCallback, useState } from 'react'
import { Linking, Text, TouchableOpacity, StyleSheet, View } from 'react-native'
import { useFocusEffect, useRouter, type Href } from 'expo-router'

import { SetUpNextShootCard } from '@/components/SetUpNextShootCard'
import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { getAuthUser } from '@/lib/getAuthUser'
import { prefetchProjectShell } from '@/lib/projectShellCache'
import {
  cacheWorkspaceProjects,
  hydrateWorkspaceProjectsFromDisk,
  loadWorkspaceProjectsCache,
  persistWorkspaceProjectsToDisk,
  pickCurrentProject,
  readCachedWorkspaceProjects,
  type ProjectListing,
} from '@/lib/workspaceProjectsLoad'

function openListing(router: ReturnType<typeof useRouter>, item: ProjectListing) {
  if (item.kind === 'private') {
    prefetchProjectShell(item.id)
    router.push(`/project/${item.id}` as Href)
    return
  }
  if (item.workspaceProjectId) {
    prefetchProjectShell(item.workspaceProjectId)
    router.push(`/project/${item.workspaceProjectId}` as Href)
    return
  }
  router.push(`/(tabs)/jobs/${item.id}` as Href)
}

function statusLine(item: ProjectListing): string {
  const status = item.statusLabel.charAt(0) + item.statusLabel.slice(1).toLowerCase()
  const bits = [status]
  if (item.subtitle) bits.push(item.subtitle)
  if (item.budgetLine) bits.push(item.budgetLine)
  return bits.join(' · ')
}

/** One in-progress project under the income block. Same card for freelancers and companies. */
export function OwnProjectsSection() {
  const router = useRouter()
  const [hidden, setHidden] = useState(false)
  const [ready, setReady] = useState(false)
  const [listings, setListings] = useState<ProjectListing[]>([])
  const [canCreate, setCanCreate] = useState(false)
  const [viewerRole, setViewerRole] = useState<'freelancer' | 'company' | null>(null)

  const load = useCallback(async () => {
    const user = await getAuthUser()
    if (!user) return
    const cached = readCachedWorkspaceProjects(user.id)
    if (cached) {
      setHidden(false)
      setListings(cached.listings)
      setCanCreate(cached.canCreatePrivate)
      setViewerRole(cached.viewerRole === 'company' ? 'company' : 'freelancer')
      setReady(true)
    } else {
      await hydrateWorkspaceProjectsFromDisk(user.id)
      const disk = readCachedWorkspaceProjects(user.id)
      if (disk) {
        setHidden(false)
        setListings(disk.listings)
        setCanCreate(disk.canCreatePrivate)
        setViewerRole(disk.viewerRole === 'company' ? 'company' : 'freelancer')
        setReady(true)
      }
    }
    const loaded = await loadWorkspaceProjectsCache(user)
    if (!loaded) {
      setHidden(true)
      setReady(true)
      return
    }
    cacheWorkspaceProjects(user.id, loaded)
    void persistWorkspaceProjectsToDisk(user.id, loaded)
    setHidden(false)
    setListings(loaded.listings)
    setCanCreate(loaded.canCreatePrivate)
    setViewerRole(loaded.viewerRole === 'company' ? 'company' : 'freelancer')
    setReady(true)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  if (!ready || hidden) return null

  const openDemo = () => {
    const base = getCreaWebBaseUrl() || 'https://www.creaservices.de'
    void Linking.openURL(`${base}/demo/overview`).catch(() => {})
  }

  const current = pickCurrentProject(listings) ?? listings[0] ?? null

  if (!current) {
    const isCompany = viewerRole === 'company'
    const browseJobs = !isCompany && !canCreate
    return (
      <SetUpNextShootCard
        canCreate={canCreate}
        onCreate={() =>
          router.push({ pathname: '/(tabs)/workspace-projects', params: { create: '1' } } as Href)
        }
        lockedHint={
          isCompany
            ? 'An admin on this company account can set up the next project.'
            : undefined
        }
        secondaryLabel={browseJobs ? 'Browse jobs' : 'Explore demo project'}
        onSecondary={
          browseJobs ? () => router.push('/(tabs)/jobs' as Href) : openDemo
        }
      />
    )
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.heading}>Current project</Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/workspace-projects' as Href)}>
          <Text style={styles.all}>All</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={styles.row}
        onPress={() => openListing(router, current)}
        accessibilityRole="button"
      >
        <Text style={styles.title} numberOfLines={2}>
          {current.title}
        </Text>
        <Text style={styles.sub} numberOfLines={2}>
          {statusLine(current)}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 20 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  heading: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  all: { color: '#FFDC00', fontSize: 13, fontWeight: '700' },
  row: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sub: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 4 },
})
