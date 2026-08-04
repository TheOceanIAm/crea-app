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
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'
import { ICON_STROKE } from '@/lib/iconTheme'

const JOB_ATTACHMENTS_BUCKET = 'job-attachments'
const MAX_BYTES = 20 * 1024 * 1024

type Props = {
  projectId: string
  /** Linked marketplace/solo job id — same store as web Files (`job_attachments`). */
  jobId: string | null
  userId: string
}

type FileRow = {
  key: string
  name: string
  /** job-attachments path, or null for legacy project-files entries */
  storagePath: string | null
  source: 'job' | 'legacy'
}

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

  if (Platform.OS !== 'web' && requireOptionalNativeModule('ExpoDocumentPicker') == null) {
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

function safeFileSegment(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_')
  return (base || 'file').slice(0, 120)
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function ProjectFilesTab({ projectId, jobId, userId }: Props) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [uploadingMedia, setUploadingMedia] = useState(false)

  const load = useCallback(async () => {
    const next: FileRow[] = []

    if (jobId) {
      const { data: rows, error } = await supabase
        .from('job_attachments')
        .select('id, file_name, storage_path, created_at')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
      if (error) {
        console.warn('[ProjectFilesTab] job_attachments', error.message)
      } else {
        for (const r of rows ?? []) {
          next.push({
            key: `job:${String(r.id)}`,
            name: String(r.file_name ?? 'file'),
            storagePath: String(r.storage_path ?? ''),
            source: 'job',
          })
        }
      }
    }

    // Legacy app uploads (pre job_attachments sync) — keep visible if present.
    const { data: legacy, error: legacyErr } = await supabase.storage
      .from('project-files')
      .list(projectId, {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      })
    if (!legacyErr) {
      for (const f of legacy ?? []) {
        const name = (f.name ?? '').trim()
        if (!name) continue
        next.push({
          key: `legacy:${name}`,
          name: name.replace(/^\d+_/, ''),
          storagePath: null,
          source: 'legacy',
        })
      }
    }

    setFiles(next)
    setLoading(false)
  }, [jobId, projectId])

  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      void load()
    }, [load])
  )

  const uploadBytes = async (
    buf: ArrayBuffer,
    baseName: string,
    mime: string,
    byteLength: number,
    setBusy: (v: boolean) => void
  ) => {
    if (!userId) {
      Alert.alert('Upload failed', 'Please sign in again.')
      setBusy(false)
      return
    }
    if (byteLength > MAX_BYTES) {
      Alert.alert('Upload failed', 'File must be 20MB or smaller.')
      setBusy(false)
      return
    }

    if (!jobId) {
      // Fallback when project has no linked job yet.
      const path = `${projectId}/${Date.now()}_${baseName}`
      const { error } = await supabase.storage.from('project-files').upload(path, buf, {
        contentType: mime || 'application/octet-stream',
        upsert: false,
      })
      if (error) Alert.alert('Upload failed', error.message)
      else {
        void load()
        void notifyExpoEvent({
          kind: 'workspace_activity',
          projectId,
          activity: 'file',
          detail: baseName,
        })
      }
      setBusy(false)
      return
    }

    const safe = safeFileSegment(baseName)
    const path = `${jobId}/${userId}/${uuid()}_${safe}`
    const { error: upErr } = await supabase.storage.from(JOB_ATTACHMENTS_BUCKET).upload(path, buf, {
      contentType: mime || 'application/octet-stream',
      upsert: false,
    })
    if (upErr) {
      Alert.alert('Upload failed', upErr.message)
      setBusy(false)
      return
    }

    const { error: insErr } = await supabase.from('job_attachments').insert({
      job_id: jobId,
      uploaded_by: userId,
      storage_path: path,
      file_name: baseName,
      file_size: byteLength,
      content_type: mime || null,
    })
    if (insErr) {
      await supabase.storage.from(JOB_ATTACHMENTS_BUCKET).remove([path])
      Alert.alert('Upload failed', insErr.message)
      setBusy(false)
      return
    }

    void load()
    void notifyExpoEvent({
      kind: 'workspace_activity',
      projectId,
      activity: 'file',
      detail: baseName,
    })
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
      await uploadBytes(
        buf,
        baseName,
        asset.mimeType ?? 'application/octet-stream',
        buf.byteLength,
        setUploadingDoc
      )
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
      await uploadBytes(
        buf,
        baseName,
        asset.mimeType ?? 'application/octet-stream',
        buf.byteLength,
        setUploadingMedia
      )
    } catch (e) {
      Alert.alert('Upload failed', String(e))
      setUploadingMedia(false)
    }
  }

  const openFile = async (row: FileRow) => {
    if (row.source === 'job' && row.storagePath) {
      const { data, error } = await supabase.storage
        .from(JOB_ATTACHMENTS_BUCKET)
        .createSignedUrl(row.storagePath, 3600)
      if (error || !data?.signedUrl) {
        Alert.alert('Could not open', error?.message ?? 'No URL')
        return
      }
      Linking.openURL(data.signedUrl).catch(() => {})
      return
    }

    const legacyName = row.key.startsWith('legacy:') ? row.key.slice('legacy:'.length) : row.name
    const path = `${projectId}/${legacyName}`
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
        <Text style={styles.uploadTextSecondary}>
          {uploadingMedia ? 'Uploading…' : 'Photo or video from library'}
        </Text>
      </TouchableOpacity>

      {files.length === 0 ? (
        <Text style={styles.empty}>No files yet.</Text>
      ) : (
        files.map((f) => (
          <TouchableOpacity key={f.key} style={styles.row} onPress={() => void openFile(f)}>
            <FileText size={20} color="#FFDC00" strokeWidth={ICON_STROKE} />
            <Text style={styles.fileName} numberOfLines={2}>
              {f.name}
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
