import { useCallback, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system'
import { decode } from 'base64-arraybuffer'
import { Upload, FileText } from 'lucide-react-native'
import { useFocusEffect } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'

type Props = { projectId: string }

export function ProjectFilesTab({ projectId }: Props) {
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.storage.from('project-files').list(projectId, {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' },
    })
    if (error) {
      if (error.message.includes('not found') || error.message.includes('Bucket')) {
        setNames([])
      } else {
        Alert.alert('Files', error.message)
        setNames([])
      }
    } else {
      const list = (data ?? []).map((f) => f.name).filter(Boolean)
      setNames(list)
    }
    setLoading(false)
  }, [projectId])

  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      load()
    }, [load])
  )

  const upload = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Photos', 'Allow photo library access to upload files.')
      return
    }

    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
      allowsMultipleSelection: false,
    })
    if (pick.canceled || !pick.assets?.length) return

    const asset = pick.assets[0]
    const uri = asset.uri
    if (!uri) return

    setUploading(true)
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const buf = decode(b64)
      const extGuess =
        asset.mimeType?.includes('video') ? 'mp4' : asset.mimeType?.includes('png') ? 'png' : 'jpg'
      const baseName = (asset.fileName || `upload.${extGuess}`).replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${projectId}/${Date.now()}_${baseName}`
      const { error } = await supabase.storage.from('project-files').upload(path, buf, {
        contentType: asset.mimeType ?? 'application/octet-stream',
        upsert: false,
      })
      if (error) {
        Alert.alert('Upload failed', error.message)
      } else {
        load()
      }
    } catch (e) {
      Alert.alert('Upload failed', String(e))
    }
    setUploading(false)
  }

  const openFile = async (name: string) => {
    const path = `${projectId}/${name}`
    const { data, error } = await supabase.storage.from('project-files').createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) {
      Alert.alert('Could not open', error?.message ?? 'No URL')
      return
    }
    Linking.openURL(data.signedUrl).catch(() => {})
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FFDC00" />
      </View>
    )
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.hint}>
        Shared photos and videos for this production (uses your photo library — no extra native build). Only project
        members can see files.
      </Text>

      <TouchableOpacity style={[styles.uploadBtn, uploading && styles.dim]} onPress={upload} disabled={uploading}>
        <Upload size={20} color="#0a0a0a" strokeWidth={ICON_STROKE} />
        <Text style={styles.uploadText}>{uploading ? 'Uploading…' : 'Upload photo or video'}</Text>
      </TouchableOpacity>

      {names.length === 0 ? (
        <Text style={styles.empty}>No files yet.</Text>
      ) : (
        names.map((n) => (
          <TouchableOpacity key={n} style={styles.row} onPress={() => openFile(n)}>
            <FileText size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.fileName} numberOfLines={2}>
              {n.replace(/^\d+_/, '')}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: 32 },
  center: { paddingVertical: 40, alignItems: 'center' },
  hint: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18, marginBottom: 16 },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#FFDC00',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  uploadText: { fontWeight: '800', color: '#0a0a0a', fontSize: 15 },
  dim: { opacity: 0.6 },
  empty: { fontSize: 14, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  fileName: { flex: 1, fontSize: 15, color: 'rgba(255,255,255,0.85)' },
})
