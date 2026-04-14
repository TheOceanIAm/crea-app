import { Alert, Linking, Platform, Share } from 'react-native'
import * as Clipboard from 'expo-clipboard'

export function composeShareText(message: string, url: string | null): string {
  const m = message.trim()
  if (url?.trim()) {
    return m ? `${m}\n\n${url.trim()}` : url.trim()
  }
  return m
}

export async function shareNative(opts: { title?: string; message: string }) {
  try {
    await Share.share({
      title: opts.title,
      message: opts.message,
      ...(Platform.OS === 'android' && opts.title ? { dialogTitle: opts.title } : {}),
    })
  } catch {
    // dismissed
  }
}

export async function copyShareText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text)
    return true
  } catch {
    return false
  }
}

export function openLinkedInShare(url: string) {
  const u = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
  Linking.openURL(u).catch(() => Alert.alert('Could not open LinkedIn'))
}

export function openTwitterShare(fullText: string) {
  const q = new URLSearchParams({ text: fullText })
  Linking.openURL(`https://twitter.com/intent/tweet?${q.toString()}`).catch(() =>
    Alert.alert('Could not open X')
  )
}

export function openWhatsAppShare(text: string) {
  Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`).catch(() =>
    Alert.alert('Could not open WhatsApp')
  )
}

export function openMailShare(subject: string, body: string) {
  const q = new URLSearchParams({ subject, body })
  Linking.openURL(`mailto:?${q.toString()}`).catch(() => Alert.alert('Could not open Mail'))
}
