import { useRef } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'

type Props = {
  value: number
  minimumValue: number
  maximumValue: number
  onValueChange: (value: number) => void
}

/** Gesture slider with no native module, so it works in the current iOS binary. */
export function TimeScrubSlider({ value, minimumValue, maximumValue, onValueChange }: Props) {
  const trackRef = useRef<View>(null)
  const frameRef = useRef({ pageX: 0, width: 1 })
  const onChangeRef = useRef(onValueChange)
  const boundsRef = useRef({ minimumValue, maximumValue })
  onChangeRef.current = onValueChange
  boundsRef.current = { minimumValue, maximumValue }

  const valueFromPageX = (pageX: number) => {
    const { pageX: origin, width } = frameRef.current
    const { minimumValue: min, maximumValue: max } = boundsRef.current
    const ratio = Math.max(0, Math.min(1, (pageX - origin) / Math.max(1, width)))
    onChangeRef.current(Math.round(min + ratio * (max - min)))
  }
  const valueFromPageXRef = useRef(valueFromPageX)
  valueFromPageXRef.current = valueFromPageX

  const measure = () => {
    trackRef.current?.measureInWindow((x, _y, width) => {
      if (width > 0) frameRef.current = { pageX: x, width }
    })
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const pageX = event.nativeEvent.pageX
        trackRef.current?.measureInWindow((x, _y, width) => {
          if (width > 0) frameRef.current = { pageX: x, width }
          valueFromPageXRef.current(pageX)
        })
      },
      onPanResponderMove: (event) => {
        valueFromPageXRef.current(event.nativeEvent.pageX)
      },
    })
  ).current

  const span = Math.max(1, maximumValue - minimumValue)
  const ratio = Math.max(0, Math.min(1, (value - minimumValue) / span))

  return (
    <View
      ref={trackRef}
      style={styles.hit}
      onLayout={measure}
      accessibilityRole="adjustable"
      {...pan.panHandlers}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      </View>
      <View style={[styles.thumb, { left: `${ratio * 100}%` }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  hit: { height: 28, justifyContent: 'center' },
  track: {
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  fill: { height: 4, backgroundColor: '#FFDC00' },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    backgroundColor: '#FFDC00',
  },
})
