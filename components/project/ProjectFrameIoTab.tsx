import { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native'
import { supabase } from '@/lib/supabase'

type Props = {
  projectId: string
  frameIoUrl: string | null
  canEdit: boolean
  onSaved: (url: string | null) => void
}

export function ProjectFrameIoTab({ projectId, frameIoUrl, canEdit, onSaved }: Props) {
  const [draft, setDraft] = useState(frameIoUrl ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(frameIoUrl ?? '')
  }, [frameIoUrl])

  const open = () => {
    const u = (canEdit ? draft : frameIoUrl)?.trim()
    if (!u) {
      Alert.alert('No link', canEdit ? 'Paste a Frame.io or review URL above.' : 'Ask the client or lead to add a link.')
      return
    }
    const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`
    Linking.openURL(withProto).catch(() => {})
  }

  const save = async () => {
    setSaving(true)
    const { error } = await supabase.rpc('project_update_frame_io_url', {
      p_project_id: projectId,
      p_url: draft.trim(),
    })
    setSaving(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    onSaved(draft.trim() || null)
    Alert.alert('Saved', 'Link updated for the whole crew.')
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>
        Open reviews in Frame.io or any browser link (Vimeo review, Dropbox, etc.). Everyone on the crew can open it.
      </Text>

      {canEdit ? (
        <>
          <Text style={styles.label}>Review link</Text>
          <TextInput
            style={styles.input}
            placeholder="https://app.frame.io/…"
            placeholderTextColor="rgba(255,255,255,0.25)"
            value={draft}
            onChangeText={setDraft}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={[styles.primary, saving && styles.dim]} onPress={save} disabled={saving}>
            <Text style={styles.primaryText}>{saving ? 'Saving…' : 'Save link'}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={styles.readonly}>
          {frameIoUrl?.trim()
            ? 'A link is set. Tap below to open in the browser.'
            : 'No review link yet. The client or lead can add one.'}
        </Text>
      )}

      <TouchableOpacity style={styles.secondary} onPress={open}>
        <Text style={styles.secondaryText}>Open in browser</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 24 },
  hint: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18, marginBottom: 20 },
  label: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
    marginBottom: 12,
  },
  primary: {
    backgroundColor: '#FFDC00',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryText: { fontWeight: '800', color: '#0a0a0a', fontSize: 16 },
  secondary: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
  },
  secondaryText: { color: '#FFDC00', fontWeight: '700', fontSize: 15 },
  readonly: { fontSize: 14, color: 'rgba(255,255,255,0.55)', marginBottom: 16, lineHeight: 20 },
  dim: { opacity: 0.6 },
})
