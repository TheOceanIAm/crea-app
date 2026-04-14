import { useMemo } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  composeShareText,
  copyShareText,
  openLinkedInShare,
  openMailShare,
  openTwitterShare,
  openWhatsAppShare,
  shareNative,
} from '@/lib/creaShare'

export type ShareSheetModalProps = {
  visible: boolean
  onClose: () => void
  sheetTitle: string
  shareMessage: string
  shareUrl: string | null
  mailSubject: string
}

export function ShareSheetModal({
  visible,
  onClose,
  sheetTitle,
  shareMessage,
  shareUrl,
  mailSubject,
}: ShareSheetModalProps) {
  const insets = useSafeAreaInsets()
  const fullText = useMemo(
    () => composeShareText(shareMessage, shareUrl),
    [shareMessage, shareUrl]
  )
  const hasBaseUrl = Boolean(shareUrl)

  const onCopy = async () => {
    const toCopy = shareUrl?.trim() || fullText
    const ok = await copyShareText(toCopy)
    if (ok) Alert.alert('Copied', shareUrl?.trim() ? 'Link copied to clipboard.' : 'Text copied.')
    else Alert.alert('Copy failed', 'Could not copy to the clipboard.')
  }

  const row = (label: string, onPress: () => void, disabled?: boolean) => (
    <TouchableOpacity
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={() => {
        if (disabled) return
        onPress()
      }}
      activeOpacity={0.75}
    >
      <Text style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}>{label}</Text>
    </TouchableOpacity>
  )

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>{sheetTitle}</Text>
          {!hasBaseUrl ? (
            <Text style={styles.warn}>
              Set <Text style={styles.mono}>EXPO_PUBLIC_CREA_WEB_URL</Text> or{' '}
              <Text style={styles.mono}>EXPO_PUBLIC_CREA_SHARE_BASE_URL</Text> in .env so shared links open on the web.
              You can still copy text or use the system share sheet.
            </Text>
          ) : shareUrl ? (
            <Text style={styles.urlPreview} numberOfLines={2}>
              {shareUrl}
            </Text>
          ) : null}

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {row('Share…', () => {
              void shareNative({ title: sheetTitle, message: fullText })
            })}
            {row('Copy link', onCopy)}
            {row('LinkedIn', () => openLinkedInShare(shareUrl!), !shareUrl)}
            {row('X (Twitter)', () => openTwitterShare(fullText))}
            {row('WhatsApp', () => openWhatsAppShare(fullText))}
            {row('Mail', () => openMailShare(mailSubject, fullText))}
          </ScrollView>

          <Text style={styles.hint}>
            For Instagram or AirDrop, use Share… and pick Instagram, Messages, or AirDrop from the system menu.
          </Text>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 10,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    maxHeight: '78%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 10,
  },
  warn: {
    fontSize: 12,
    color: 'rgba(255,220,0,0.85)',
    lineHeight: 17,
    marginBottom: 12,
  },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11 },
  urlPreview: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 12,
    lineHeight: 17,
  },
  scroll: { maxHeight: 320 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  rowDisabled: { opacity: 0.35 },
  rowLabel: { fontSize: 16, fontWeight: '600', color: '#FFDC00' },
  rowLabelDisabled: { color: 'rgba(255,255,255,0.25)' },
  hint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    lineHeight: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  closeBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  closeBtnText: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.75)' },
})
