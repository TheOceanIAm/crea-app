import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { Alert, View } from 'react-native'
import { encode } from 'base64-arraybuffer'
import { getCreaWebBaseUrl } from '@/lib/creaWeb'
import { type JobStoryFields } from '@/lib/jobStoryHtml'
import { nativeBinaryHasWebView } from '@/lib/nativeWebView'

type WebViewMessageEvent = { nativeEvent: { data: string } }
type NativeWebViewComponent = ComponentType<{
  originWhitelist?: string[]
  source?: { html: string; baseUrl?: string }
  style?: object
  onMessage?: (event: WebViewMessageEvent) => void
  onError?: () => void
  javaScriptEnabled?: boolean
  scrollEnabled?: boolean
  pointerEvents?: 'none' | 'auto' | 'box-none' | 'box-only'
}>

function loadNativeWebView(): NativeWebViewComponent | null {
  if (!nativeBinaryHasWebView()) return null
  try {
    return require('react-native-webview').WebView as NativeWebViewComponent
  } catch {
    return null
  }
}

export type JobStoryShareInput = JobStoryFields & {
  jobId: string
  companyLogoUrl?: string | null
}

type StoryRequest = { id: number; html: string; jobId: string }
type ChunkBag = { n: number; parts: Array<string | undefined> }

export function useJobStoryShare() {
  const [busy, setBusy] = useState(false)
  const [request, setRequest] = useState<StoryRequest | null>(null)
  const alive = useRef(true)
  const chunks = useRef<Map<string, ChunkBag>>(new Map())
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timeout.current) clearTimeout(timeout.current)
    }
  }, [])

  const fail = useCallback((message: string) => {
    if (timeout.current) clearTimeout(timeout.current)
    timeout.current = null
    chunks.current.clear()
    if (!alive.current) return
    setRequest(null)
    setBusy(false)
    Alert.alert('Story image', message)
  }, [])

  const finish = useCallback(async (jobId: string, base64: string) => {
    if (timeout.current) clearTimeout(timeout.current)
    timeout.current = null
    chunks.current.clear()
    if (!alive.current) return
    const FileSystem = await import('expo-file-system')
    const Sharing = await import('expo-sharing')
    const cache = FileSystem.cacheDirectory
    if (!cache || !base64) {
      fail('Could not create the story image.')
      return
    }
    const safe = jobId.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 12) || 'job'
    const uri = `${cache}crea-job-story-${safe}.png`
    try {
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 })
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: 'Story image',
        }).catch(() => {})
      } else {
        Alert.alert('Story image', 'Sharing is not available on this device.')
      }
    } catch {
      if (alive.current) Alert.alert('Story image', 'Could not save the story image.')
    } finally {
      if (alive.current) {
        setRequest(null)
        setBusy(false)
      }
    }
  }, [fail])

  const onMessage = useCallback(
    (raw: string) => {
      let msg: { ok?: boolean; error?: string; id?: string; i?: number; n?: number; chunk?: string }
      try {
        msg = JSON.parse(raw) as typeof msg
      } catch {
        fail('Could not create the story image.')
        return
      }
      if (!msg.ok || !msg.id || msg.chunk == null || msg.i == null || msg.n == null) {
        fail(msg.error || 'Could not create the story image.')
        return
      }
      let bag = chunks.current.get(msg.id)
      if (!bag) {
        bag = { n: msg.n, parts: [] }
        chunks.current.set(msg.id, bag)
      }
      bag.parts[msg.i] = msg.chunk
      let filled = 0
      for (let i = 0; i < bag.n; i++) if (bag.parts[i] != null) filled += 1
      if (filled < bag.n) return
      const jobId = request?.jobId || 'job'
      void finish(jobId, bag.parts.join(''))
    },
    [fail, finish, request?.jobId]
  )

  const shareStory = useCallback(
    async (input: JobStoryShareInput) => {
      if (busy) return
      const base = getCreaWebBaseUrl()
      if (!base) {
        fail('Could not create the story image.')
        return
      }
      setBusy(true)
      try {
        const res = await fetch(`${base}/api/og/job-story`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'image/png' },
          body: JSON.stringify({
            jobTitle: input.jobTitle,
            company: input.company,
            companyLogoUrl: input.companyLogoUrl ?? null,
            budget: input.budget,
            location: input.location,
            description: input.description,
            engagement: input.engagement ?? null,
            isFreelance: input.isFreelance ?? null,
          }),
        })
        if (!alive.current) return
        if (!res.ok) {
          fail('Could not create the story image. Try again.')
          return
        }
        const png = encode(await res.arrayBuffer())
        if (!alive.current) return
        await finish(input.jobId, png)
      } catch {
        if (alive.current) fail('Could not create the story image. Try again.')
      }
    },
    [busy, fail, finish]
  )

  const WebView = request ? loadNativeWebView() : null
  const holder = request && WebView ? (
    <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, left: -20, top: 0 }}>
      <WebView
        key={request.id}
        originWhitelist={['*']}
        source={{ html: request.html, baseUrl: 'https://crea.local' }}
        style={{ width: 1, height: 1 }}
        javaScriptEnabled
        scrollEnabled={false}
        onMessage={(event) => onMessage(event.nativeEvent.data)}
        onError={() => fail('Could not create the story image.')}
      />
    </View>
  ) : null

  return { shareStory, busy, holder }
}
