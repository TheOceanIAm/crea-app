import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Linking } from 'react-native'
import { supabase } from '@/lib/supabase'
import { notifyExpoEvent } from '@/lib/notifyExpoEvent'

type Props = {
  projectId: string
  jobId?: string | null
  frameIoUrl: string | null
  picdropUrl: string | null
  canEdit: boolean
  onSaved: (next: { frame_io_url: string | null; picdrop_url: string | null }) => void
}

function openUrl(raw: string | null | undefined, canEdit: boolean, draft: string) {
  const u = (canEdit ? draft : raw)?.trim()
  if (!u) {
    Alert.alert('No link', canEdit ? 'Paste a URL above.' : 'Ask the client or lead to add a link.')
    return
  }
  const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`
  Linking.openURL(withProto).catch(() => {})
}

export function ProjectReviewTab({ projectId, jobId, frameIoUrl, picdropUrl, canEdit, onSaved }: Props) {
  const [frameDraft, setFrameDraft] = useState(frameIoUrl ?? '')
  const [picDraft, setPicDraft] = useState(picdropUrl ?? '')
  const [savingFrame, setSavingFrame] = useState(false)
  const [savingPic, setSavingPic] = useState(false)

  useEffect(() => {
    setFrameDraft(frameIoUrl ?? '')
  }, [frameIoUrl])
  useEffect(() => {
    setPicDraft(picdropUrl ?? '')
  }, [picdropUrl])

  const saveFrame = async () => {
    setSavingFrame(true)
    const { error } = await supabase.rpc('project_update_frame_io_url', {
      p_project_id: projectId,
      p_url: frameDraft.trim(),
    })
    setSavingFrame(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    onSaved({ frame_io_url: frameDraft.trim() || null, picdrop_url: picdropUrl ?? null })
    void notifyExpoEvent({
      kind: 'workspace_activity',
      projectId,
      jobId: jobId ?? undefined,
      activity: 'review_link',
      detail: 'Frame.io link updated',
    })
    Alert.alert('Saved', 'Frame.io link updated for the crew.')
  }

  const savePic = async () => {
    setSavingPic(true)
    const { error } = await supabase.rpc('project_update_picdrop_url', {
      p_project_id: projectId,
      p_url: picDraft.trim(),
    })
    setSavingPic(false)
    if (error) {
      Alert.alert('Save failed', error.message)
      return
    }
    onSaved({ frame_io_url: frameIoUrl ?? null, picdrop_url: picDraft.trim() || null })
    void notifyExpoEvent({
      kind: 'workspace_activity',
      projectId,
      jobId: jobId ?? undefined,
      activity: 'review_link',
      detail: 'PicDrop link updated',
    })
    Alert.alert('Saved', 'PicDrop link updated for the crew.')
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.lead}>
        Central place for review and delivery links. Company or lead can edit; everyone on the project can open them in
        the browser.
      </Text>

      <View style={styles.card}>
        <Text style={styles.brand}>Frame.io</Text>
        <Text style={styles.hint}>Comments, versions, and approvals in Frame.io (or paste any review URL).</Text>
        {canEdit ? (
          <>
            <Text style={styles.label}>Link</Text>
            <TextInput
              style={styles.input}
              placeholder="https://app.frame.io/…"
              placeholderTextColor="rgba(255,255,255,0.25)"
              value={frameDraft}
              onChangeText={setFrameDraft}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={[styles.primary, savingFrame && styles.dim]} onPress={saveFrame} disabled={savingFrame}>
              <Text style={styles.primaryText}>{savingFrame ? 'Saving…' : 'Save Frame.io link'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.readonly}>
            {frameIoUrl?.trim()
              ? 'A link is set. Tap below to open.'
              : 'No Frame.io link yet. The client or lead can add one.'}
          </Text>
        )}
        <TouchableOpacity style={styles.secondary} onPress={() => openUrl(frameIoUrl, canEdit, frameDraft)}>
          <Text style={styles.secondaryText}>Open Frame.io</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.brand}>PicDrop</Text>
        <Text style={styles.hint}>Galleries and file delivery via PicDrop (or compatible link).</Text>
        {canEdit ? (
          <>
            <Text style={styles.label}>Link</Text>
            <TextInput
              style={styles.input}
              placeholder="https://…"
              placeholderTextColor="rgba(255,255,255,0.25)"
              value={picDraft}
              onChangeText={setPicDraft}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={[styles.primary, savingPic && styles.dim]} onPress={savePic} disabled={savingPic}>
              <Text style={styles.primaryText}>{savingPic ? 'Saving…' : 'Save PicDrop link'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.readonly}>
            {picdropUrl?.trim()
              ? 'A link is set. Tap below to open.'
              : 'No PicDrop link yet. The client or lead can add one.'}
          </Text>
        )}
        <TouchableOpacity style={styles.secondary} onPress={() => openUrl(picdropUrl, canEdit, picDraft)}>
          <Text style={styles.secondaryText}>Open PicDrop</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 24 },
  lead: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 18, marginBottom: 20 },
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 16,
    marginBottom: 16,
  },
  brand: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 6 },
  hint: { fontSize: 12, color: 'rgba(255,255,255,0.38)', lineHeight: 17, marginBottom: 14 },
  label: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0a0a0a',
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
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryText: { fontWeight: '800', color: '#0a0a0a', fontSize: 15 },
  secondary: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.35)',
  },
  secondaryText: { color: '#FFDC00', fontWeight: '700', fontSize: 14 },
  readonly: { fontSize: 14, color: 'rgba(255,255,255,0.55)', marginBottom: 12, lineHeight: 20 },
  dim: { opacity: 0.6 },
})
