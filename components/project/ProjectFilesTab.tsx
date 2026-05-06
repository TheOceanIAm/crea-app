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
  Platform,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system'
import { decode } from 'base64-arraybuffer'
import { FileText, ImageIcon, Upload } from 'lucide-react-native'
import { useFocusEffect } from 'expo-router'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { supabase } from '@/lib/supabase'
import { ICON_STROKE } from '@/lib/iconTheme'

type Props = { projectId: string }

type DocumentPickerModule = {
  getDocumentAsync: (opts?: {
    type?: string | string[]
    copyToCacheDirectory?: boolean
    multiple?: boolean
  }) => Promise<
    | { canceled: true; assets: null }
    | { canceled: false; assets: { uri: string; name?: string; mimeType?: string }[] }
  >
}

let documentPickerLoad: DocumentPickerModule | false | undefined

function getDocumentPicker(): DocumentPickerModule | null {
  if (documentPickerLoad === false) return null
  if (documentPickerLoad) return documentPickerLoad

  // Never call require('expo-document-picker') on native unless the native module exists — loading
  // the JS package calls requireNativeModule and throws before try/catch helps.
  if (
    Platform.OS !== 'web' &&
    requireOptionalNativeModule('ExpoDocumentPicker') == null
  ) {
    documentPickerLoad = false
    return null
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    documentPickerLoad = require('expo-document-picker') as DocumentPickerModule
    return documentPickerLoad
  } catch {
    documentPickerLoad = false
    return null
  }
}

function guessExt(name: string, mime?: string | null): string {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot >= 0 && dot < lower.length - 1) {
    const ext = lower.slice(dot + 1).replace(/[^a-z0-9]/g, '')
    if (ext) return ext
  }
  if (mime?.includes('pdf')) return 'pdf'
  if (mime?.includes('word') || mime?.includes('document')) return 'docx'
  if (mime?.includes('spreadsheet') || mime?.includes('excel')) return 'xlsx'
  if (mime?.includes('zip')) return 'zip'
  return 'bin'
}

export function ProjectFilesTab({ projectId }: Props) {
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [uploadingMedia, setUploadingMedia] = useState(false)

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

  const uploadBytes = async (
    buf: ArrayBuffer,
    baseName: string,
    mime: string,
    setBusy: (v: boolean) => void
  ) => {
    const path = `${projectId}/${Date.now()}_${baseName}`
    const { error } = await supabase.storage.from('project-files').upload(path, buf, {
      contentType: mime || 'application/octet-stream',
      upsert: false,
    })
    if (error) {
      Alert.alert('Upload failed', error.message)
    } else {
      void load()
    }
    setBusy(false)
  }

  const pickDocument = async () => {
    const DP = getDocumentPicker()
    if (!DP) {
      Alert.alert(
        'PDF & documents',
        'This install does not include the document picker yet. Install the latest CREA build from TestFlight / Play Store, or run a fresh development build after updating. You can still upload photos and videos below, or add PDFs from the web workspace.'
      )
      return
    }

    setUploadingDoc(true)
    try {
      const result = await DP.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      })
      if (result.canceled || !result.assets?.length) {
        setUploadingDoc(false)
        return
      }

      const asset = result.assets[0]
      const uri = asset.uri
      if (!uri) {
        setUploadingDoc(false)
        return
      }

      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const buf = decode(b64)
      const safeBase =
        (asset.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_') || 'document'
      const ext = guessExt(asset.name || '', asset.mimeType)
      const baseName = safeBase.includes('.') ? safeBase : `${safeBase}.${ext}`
      await uploadBytes(buf, baseName, asset.mimeType ?? 'application/octet-stream', setUploadingDoc)
    } catch (e) {
      Alert.alert('Upload failed', String(e))
      setUploadingDoc(false)
    }
  }

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Photo library', 'Allow access to add photos or videos from your library.')
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

    setUploadingMedia(true)
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const buf = decode(b64)
      const extGuess =
        asset.mimeType?.includes('video') ? 'mp4' : asset.mimeType?.includes('png') ? 'png' : 'jpg'
      const baseName = (asset.fileName || `upload.${extGuess}`).replace(/[^a-zA-Z0-9._-]/g, '_')
      await uploadBytes(buf, baseName, asset.mimeType ?? 'application/octet-stream', setUploadingMedia)
    } catch (e) {
      Alert.alert('Upload failed', String(e))
      setUploadingMedia(false)
    }
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

  const busy = uploadingDoc || uploadingMedia

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.hint}>
        Contracts, briefs, PDFs, and references — same workspace files as on web. Only project members can see these
        files.
      </Text>

      <TouchableOpacity
        style={[styles.uploadBtn, (busy || uploadingDoc) && styles.dim]}
        onPress={() => void pickDocument()}
        disabled={busy}
      >
        <Upload size={20} color="#0a0a0a" strokeWidth={ICON_STROKE} />
        <Text style={styles.uploadText}>{uploadingDoc ? 'Uploading…' : 'Upload PDF or file'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.uploadBtnSecondary, (busy || uploadingMedia) && styles.dim]}
        onPress={() => void pickFromLibrary()}
        disabled={busy}
      >
        <ImageIcon size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
        <Text style={styles.uploadTextSecondary}>{uploadingMedia ? 'Uploading…' : 'Photo or video from library'}</Text>
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
    alignSelf: 'stretch',
    backgroundColor: '#FFDC00',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  uploadBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 20,
  },
  uploadText: { fontWeight: '800', color: '#0a0a0a', fontSize: 15 },
  uploadTextSecondary: { fontWeight: '700', color: '#FFDC00', fontSize: 15 },
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
