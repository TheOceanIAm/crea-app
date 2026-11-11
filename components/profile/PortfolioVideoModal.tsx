import { useEffect, useState, type ComponentType } from 'react'
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { X } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { nativeBinaryHasWebView } from '@/lib/nativeWebView'
import type { PortfolioVideoEmbed } from '@/lib/portfolioVideoEmbed'

type WebViewMessageEvent = { nativeEvent: { data: string } }
type NativeWebViewComponent = ComponentType<{
  source: { html: string; baseUrl?: string }
  style?: object
  allowsFullscreenVideo?: boolean
  allowsInlineMediaPlayback?: boolean
  mediaPlaybackRequiresUserAction?: boolean
  javaScriptEnabled?: boolean
  domStorageEnabled?: boolean
  setSupportMultipleWindows?: boolean
  originWhitelist?: string[]
  onMessage?: (event: WebViewMessageEvent) => void
}>

function loadNativeWebView(): NativeWebViewComponent | null {
  if (Platform.OS === 'web') return null
  if (!nativeBinaryHasWebView()) return null
  try {
    return require('react-native-webview').WebView as NativeWebViewComponent
  } catch {
    return null
  }
}

function playerDocument(embedUrl: string): string {
  const src = embedUrl.replace(/"/g, '')
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000;height:100%}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${src}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen playsinline></iframe></body></html>`
}

type Props = {
  title: string
  embed: PortfolioVideoEmbed
  onClose: () => void
}

export function PortfolioVideoModal({ title, embed, onClose }: Props) {
  const [showPlayer, setShowPlayer] = useState(false)
  const WebView = showPlayer ? loadNativeWebView() : null
  const html = showPlayer ? playerDocument(embed.embedUrl) : ''

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShowPlayer(true))
    return () => cancelAnimationFrame(frame)
  }, [embed.embedUrl])

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.provider}>{embed.label}</Text>
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <X size={22} color="rgba(255,255,255,0.7)" strokeWidth={ICON_STROKE} />
            </Pressable>
          </View>
          <View style={styles.frame}>
            {WebView ? (
              <WebView
                source={{ html, baseUrl: 'https://creaservices.de' }}
                style={styles.web}
                allowsFullscreenVideo
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                javaScriptEnabled
                domStorageEnabled
                setSupportMultipleWindows={false}
                originWhitelist={['*']}
              />
            ) : showPlayer ? (
              <Pressable style={styles.fallback} onPress={() => Linking.openURL(embed.watchUrl).catch(() => {})}>
                <Text style={styles.fallbackText}>Open on {embed.label}</Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable onPress={() => Linking.openURL(embed.watchUrl).catch(() => {})} style={styles.external}>
            <Text style={styles.externalText}>Open on {embed.label}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  sheet: {
    backgroundColor: '#161616',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerText: { flex: 1, minWidth: 0 },
  provider: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.4)',
    textTransform: 'uppercase',
  },
  title: { marginTop: 4, fontSize: 15, fontWeight: '600', color: '#fff' },
  frame: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
  },
  web: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: '#FFDC00', fontSize: 14, fontWeight: '700' },
  external: { paddingVertical: 12, paddingHorizontal: 16, alignItems: 'flex-end' },
  externalText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.45)',
  },
})
