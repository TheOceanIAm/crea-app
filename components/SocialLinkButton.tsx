import { Linking, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native'
import { SocialPlatformIcon, type SocialPlatformId } from '@/components/SocialPlatformIcon'

type Props = {
  platform: SocialPlatformId
  url: string | null
  accessibilityLabel: string
  style?: StyleProp<ViewStyle>
}

export function SocialLinkButton({ platform, url, accessibilityLabel, style }: Props) {
  if (!url) return null
  return (
    <TouchableOpacity
      style={[styles.btn, style]}
      onPress={() => Linking.openURL(url).catch(() => {})}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      activeOpacity={0.85}
    >
      <SocialPlatformIcon platform={platform} size={18} color="#FFDC00" />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
})
