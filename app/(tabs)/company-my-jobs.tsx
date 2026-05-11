import { useEffect } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'

/**
 * Legacy route — company listings now live on the Projects tab (`/(tabs)/jobs`).
 * Keeps old links/bookmarks working.
 */
export default function CompanyMyJobsRedirectScreen() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/(tabs)/jobs')
  }, [router])
  return (
    <View style={styles.center}>
      <ActivityIndicator color="#FFDC00" size="large" />
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center' },
})
