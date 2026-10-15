import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { decode } from 'base64-arraybuffer'
import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { Plus, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ICON_STROKE } from '@/lib/iconTheme'
import { supabase } from '@/lib/supabase'

type ShotPhoto = { id: string; uri: string; path: string }

const BUCKET = 'shot-photos'

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function signedPhotos(projectId: string, shootDay: string, shotId: string): Promise<ShotPhoto[]> {
  const { data, error } = await supabase
    .from('production_shot_photos')
    .select('id, storage_path')
    .eq('project_id', projectId)
    .eq('shoot_date', shootDay)
    .eq('shot_id', shotId)
    .order('created_at', { ascending: true })
  if (error || !data?.length) return []
  const paths = data.map((row) => String(row.storage_path))
  const signed = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 60)
  return data
    .map((row, rowIndex) => ({
      id: String(row.id),
      path: String(row.storage_path),
      uri: signed.data?.[rowIndex]?.signedUrl ?? '',
    }))
    .filter((photo) => photo.uri)
}

export function ShotPhotos({
  projectId,
  shootDay,
  shotId,
  readOnly = false,
}: {
  projectId: string
  shootDay: string
  shotId: string
  readOnly?: boolean
}) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const frameHeight = Math.max(height - insets.top - insets.bottom - 150, height * 0.55)
  const [photos, setPhotos] = useState<ShotPhoto[]>([])
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const scroller = useRef<ScrollView>(null)
  const photosRef = useRef(photos)
  photosRef.current = photos

  const reload = useCallback(async () => {
    try {
      setPhotos(await signedPhotos(projectId, shootDay, shotId))
    } catch {
      setPhotos([])
    }
  }, [projectId, shootDay, shotId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    const channel = supabase
      .channel(`shot-photos-${projectId}-${shotId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'production_shot_photos', filter: `project_id=eq.${projectId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { shot_id?: string; shoot_date?: string }
          if (row.shot_id && row.shot_id !== shotId) return
          if (row.shoot_date && String(row.shoot_date) !== shootDay) return
          void reload()
        }
      )
      .subscribe()
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload()
    })
    return () => {
      appState.remove()
      void supabase.removeChannel(channel)
    }
  }, [projectId, reload, shootDay, shotId])

  const openAt = (nextIndex: number) => {
    setIndex(nextIndex)
    setOpen(true)
  }

  const addPhotos = async () => {
    if (readOnly || saving) return
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Photos', 'Allow photo library access to attach references to this shot.')
      return
    }
    // The iOS 26 multi-select checkmark closes the sheet and hands back no file.
    // The crop confirm (same path as the profile photo) returns the image, then we keep our own copy.
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
      base64: true,
    })
    if (picked.canceled || !picked.assets?.[0]?.uri) return
    const asset = picked.assets[0]
    setSaving(true)
    try {
      const base64 =
        asset.base64 ??
        (await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }))
      const id = newId()
      const path = `${projectId}/${id}.jpg`
      const uploaded = await supabase.storage.from(BUCKET).upload(path, decode(base64), {
        contentType: 'image/jpeg',
        upsert: false,
      })
      if (uploaded.error) throw uploaded.error
      const inserted = await supabase.from('production_shot_photos').insert({
        project_id: projectId,
        shoot_date: shootDay,
        shot_id: shotId,
        storage_path: path,
      })
      if (inserted.error) {
        await supabase.storage.from(BUCKET).remove([path])
        throw inserted.error
      }
      const start = photosRef.current.length
      await reload()
      openAt(start)
    } catch {
      Alert.alert('Photos', 'Could not add that photo to the shot.')
    } finally {
      setSaving(false)
    }
  }

  const removeCurrent = () => {
    const current = photos[index]
    if (!current) return
    const next = photos.filter((photo) => photo.id !== current.id)
    setPhotos(next)
    if (!next.length) {
      setOpen(false)
      setIndex(0)
    } else {
      setIndex(Math.min(index, next.length - 1))
    }
    void supabase.from('production_shot_photos').delete().eq('id', current.id)
    if (current.path) void supabase.storage.from(BUCKET).remove([current.path])
  }

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1))
    if (next >= 0 && next < photos.length) setIndex(next)
  }

  if (readOnly && photos.length === 0) return null

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Photos</Text>
      <View style={styles.row}>
        {photos.map((photo, photoIndex) => (
          <TouchableOpacity key={photo.id} onPress={() => openAt(photoIndex)} activeOpacity={0.85}>
            <Image source={{ uri: photo.uri }} style={styles.thumb} />
          </TouchableOpacity>
        ))}
        {readOnly ? null : (
          <TouchableOpacity style={styles.add} onPress={() => void addPhotos()} activeOpacity={0.85} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#FFDC00" />
            ) : (
              <Plus size={18} color="#FFDC00" strokeWidth={ICON_STROKE} />
            )}
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={styles.backdrop}>
          <TouchableOpacity
            style={[styles.close, { top: Math.max(insets.top, 12) + 8, right: 16 }]}
            onPress={() => setOpen(false)}
            hitSlop={10}
            accessibilityLabel="Close"
          >
            <X size={22} color="#fff" strokeWidth={ICON_STROKE} />
          </TouchableOpacity>

          <View style={styles.stage}>
            <ScrollView
              ref={scroller}
              style={{ width, height: frameHeight }}
              horizontal
              pagingEnabled
              bounces={photos.length > 1}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              onLayout={() => scroller.current?.scrollTo({ x: index * width, animated: false })}
              onMomentumScrollEnd={onScrollEnd}
            >
              {photos.map((photo) => (
                <View key={photo.id} style={[styles.slide, { width, height: frameHeight }]}>
                  <Image
                    source={{ uri: photo.uri }}
                    style={{ width: width - 56, height: frameHeight }}
                    resizeMode="contain"
                  />
                </View>
              ))}
            </ScrollView>
          </View>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text style={styles.counter}>
              {photos.length ? `${Math.min(index, photos.length - 1) + 1} / ${photos.length}` : ''}
            </Text>
            {photos.length > 1 ? (
              <View style={styles.dots}>
                {photos.map((photo, photoIndex) => (
                  <View key={photo.id} style={[styles.dot, photoIndex === index && styles.dotActive]} />
                ))}
              </View>
            ) : null}
            {readOnly ? null : (
              <TouchableOpacity onPress={removeCurrent} hitSlop={8}>
                <Text style={styles.remove}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  label: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
  },
  add: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,220,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,220,0,0.06)',
  },
  backdrop: {
    flex: 1,
    backgroundColor: '#000',
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  close: {
    position: 'absolute',
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { alignItems: 'center', gap: 10, paddingTop: 8 },
  counter: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
  dotActive: { width: 18, backgroundColor: '#FFDC00' },
  remove: { color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: '700' },
})
