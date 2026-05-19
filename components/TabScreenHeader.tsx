import { ReactNode } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { MessageCircle } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { useUnreadDmCount } from '@/hooks/useUnreadDmCount'
import { supabase } from '@/lib/supabase'
import { useEffect, useState } from 'react'

type Props = {
  title: string
  left?: ReactNode
  /** Hide messages icon (e.g. workspace-only accounts). */
  showMessages?: boolean
}

export function TabScreenHeader({ title, left, showMessages = true }: Props) {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null)
    })
  }, [])

  const { unreadDmCount } = useUnreadDmCount(userId, showMessages)

  return (
    <View style={styles.bar}>
      {left ?? <View style={styles.leftSpacer} />}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {showMessages ? (
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/messages')}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Messages"
        >
          <MessageCircle size={22} color="rgba(255,255,255,0.55)" strokeWidth={ICON_STROKE} />
          {unreadDmCount > 0 ? <View style={styles.dot} /> : null}
        </TouchableOpacity>
      ) : (
        <View style={styles.leftSpacer} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 8,
  },
  leftSpacer: { width: 44 },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  iconBtn: { padding: 8, position: 'relative' },
  dot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: '#ff2d55',
  },
})
