import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { CREA_WORDMARK_PATH, CREA_WORDMARK_VIEWBOX } from '@/lib/creaWordmark'

const VIEWBOX_WIDTH = 4132
const VIEWBOX_HEIGHT = 810

type Props = {
  width?: number
  color?: string
  style?: StyleProp<ViewStyle>
}

/** Climate Crisis CREA outlines. Same path as the website wordmark. */
export function CreaWordmark({ width = 248, color = '#FFDC00', style }: Props) {
  const height = width * (VIEWBOX_HEIGHT / VIEWBOX_WIDTH)
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="CREA"
      style={[styles.wrap, { width, height }, style]}
    >
      <Svg width={width} height={height} viewBox={CREA_WORDMARK_VIEWBOX}>
        <Path d={CREA_WORDMARK_PATH} fill={color} />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
  },
})
