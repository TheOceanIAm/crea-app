import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Search, X } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { fetchCreaApi } from '@/lib/creaApiFetch'
import {
  searchWorkspace,
  WORKSPACE_SEARCH_GROUPS,
  type WorkspaceSearchHit,
  type WorkspaceSearchTab,
} from '@/lib/workspaceSearch'

type Props = {
  projectId: string
  jobId: string | null
  title: string
  includeMessages: boolean
  onOpenTab: (tab: WorkspaceSearchTab) => void
  onOpenChange?: (open: boolean) => void
  leading?: ReactNode
  trailing?: ReactNode
}

export function ProjectWorkspaceSearch({
  projectId,
  jobId,
  title,
  includeMessages,
  onOpenTab,
  onOpenChange,
  leading,
  trailing,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<WorkspaceSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const indexedJob = useRef<string | null>(null)
  const inputRef = useRef<TextInput | null>(null)

  const setSearchOpen = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
    if (!next) {
      setQuery('')
      setHits([])
    }
  }

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open || !jobId || indexedJob.current === jobId) return
    indexedJob.current = jobId
    void fetchCreaApi('/api/job-attachments/index-pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
      timeoutMs: 20_000,
    })
  }, [open, jobId])

  useEffect(() => {
    if (!open) return
    const needle = query.trim()
    if (needle.length < 2) {
      setHits([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      void searchWorkspace({
        projectId,
        jobId,
        query: needle,
        includeMessages,
      })
        .then((next) => {
          if (!cancelled) setHits(next)
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 160)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, query, projectId, jobId, includeMessages])

  const groups = useMemo(
    () =>
      WORKSPACE_SEARCH_GROUPS.map((group) => ({
        ...group,
        hits: hits.filter((hit) => hit.kind === group.kind),
      })).filter((group) => group.hits.length > 0),
    [hits]
  )

  const showMenu = open && query.trim().length >= 2

  const openHit = (hit: WorkspaceSearchHit) => {
    setSearchOpen(false)
    onOpenTab(hit.tab)
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        {leading}
        {open ? (
          <View style={styles.field}>
            <Search size={16} color="rgba(255,255,255,0.4)" strokeWidth={ICON_STROKE} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="People, files, documents, chat"
              placeholderTextColor="rgba(255,255,255,0.28)"
              style={styles.input}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              blurOnSubmit={false}
            />
            {loading ? <ActivityIndicator color="#FFDC00" size="small" /> : null}
          </View>
        ) : (
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
        )}
        <View style={styles.headerActions}>
          {open ? (
            <Pressable onPress={() => setSearchOpen(false)} hitSlop={8} accessibilityLabel="Close search">
              <X size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
            </Pressable>
          ) : (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => setSearchOpen(true)}
              hitSlop={8}
              accessibilityLabel="Search workspace"
            >
              <Search size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          )}
          {open ? null : trailing}
        </View>
      </View>
      {showMenu ? (
        <View style={styles.dropdown}>
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.dropdownScroll}>
            {groups.length === 0 && !loading ? (
              <Text style={styles.empty}>No matches in this project.</Text>
            ) : (
              groups.map((group) => (
                <View key={group.kind}>
                  <Text style={styles.groupLabel}>{group.label}</Text>
                  {group.hits.map((hit) => (
                    <TouchableOpacity key={`${hit.kind}-${hit.id}`} style={styles.hit} onPress={() => openHit(hit)}>
                      <View style={styles.hitTop}>
                        <Text style={styles.hitTitle} numberOfLines={1}>
                          {hit.title}
                        </Text>
                        {hit.meta ? <Text style={styles.hitMeta}>{hit.meta}</Text> : null}
                      </View>
                      {hit.snippet ? (
                        <Text style={styles.hitSnippet} numberOfLines={1}>
                          {hit.snippet}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { zIndex: 30 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { paddingVertical: 8, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#141414',
  },
  input: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 0 },
  dropdown: {
    marginHorizontal: 12,
    marginBottom: 6,
    maxHeight: 320,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: '#161616',
    overflow: 'hidden',
  },
  dropdownScroll: { maxHeight: 320 },
  empty: { color: 'rgba(255,255,255,0.4)', fontSize: 13, paddingHorizontal: 14, paddingVertical: 16 },
  groupLabel: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 2,
  },
  hit: { paddingHorizontal: 14, paddingVertical: 10 },
  hitTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hitTitle: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '700' },
  hitMeta: { color: 'rgba(255,220,0,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  hitSnippet: { color: 'rgba(255,255,255,0.42)', fontSize: 12, marginTop: 2 },
})
