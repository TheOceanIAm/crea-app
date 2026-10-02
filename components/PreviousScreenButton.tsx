import { useCallback, useState } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useRouter, type Href } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { ICON_STROKE } from '@/lib/iconTheme'
import { peekScreenReturn, returnToPreviousScreen } from '@/lib/screenReturn'

/** Small back chevron. Returns to the screen that opened this one. */
export function PreviousScreenButton({ always = false }: { always?: boolean }) {
  const router = useRouter()
  const [from, setFrom] = useState<Href | null>(null)

  useFocusEffect(
    useCallback(() => {
      setFrom(peekScreenReturn())
    }, [])
  )

  if (!always && !from) return null

  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={() => returnToPreviousScreen(router)}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ChevronLeft size={22} color="rgba(255,255,255,0.72)" strokeWidth={ICON_STROKE} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  btn: { alignSelf: 'flex-start', marginLeft: 8, marginTop: 4, padding: 4 },
})
