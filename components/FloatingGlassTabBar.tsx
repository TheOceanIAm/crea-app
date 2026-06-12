import { BlurView } from 'expo-blur'
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  FLOATING_TAB_BAR_BOTTOM_GAP,
  FLOATING_TAB_BAR_HORIZONTAL_INSET,
  FLOATING_TAB_BAR_PILL_HEIGHT,
} from '@/lib/floatingTabBarLayout'

/** Only these routes may appear in the floating bar (expo-router hides others via tabBarItemStyle). */
const MAIN_TAB_ROUTE_NAMES = new Set([
  'feed',
  'dashboard',
  'jobs',
  'workspace-projects',
  'notifications',
  'profile',
])

function isTabVisible(
  routeName: string,
  options: BottomTabBarProps['descriptors'][string]['options']
): boolean {
  if (!MAIN_TAB_ROUTE_NAMES.has(routeName)) return false
  if (options.tabBarButton === null) return false
  if (!options.tabBarIcon) return false

  const itemStyle = StyleSheet.flatten(options.tabBarItemStyle ?? {})
  if (itemStyle.display === 'none') return false

  return true
}

export function FloatingGlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()

  const visibleRoutes = state.routes
    .map((route) => ({ route, options: descriptors[route.key].options }))
    .filter(({ route, options }) => isTabVisible(route.name, options))

  return (
    <View
      style={[styles.outer, { paddingBottom: insets.bottom + FLOATING_TAB_BAR_BOTTOM_GAP }]}
      pointerEvents="box-none"
    >
      <View style={styles.pill}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={72} tint="dark" style={StyleSheet.absoluteFillObject} />
        ) : (
          <BlurView
            intensity={90}
            tint="dark"
            style={StyleSheet.absoluteFillObject}
            experimentalBlurMethod="dimezisBlurView"
          />
        )}
        <View style={styles.pillTint} pointerEvents="none" />
        <View style={styles.row}>
          {visibleRoutes.map(({ route, options }) => {
            const isFocused = state.routes[state.index]?.key === route.key
            const color = isFocused ? '#FFDC00' : 'rgba(255,255,255,0.42)'

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              })
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params)
              }
            }

            const onLongPress = () => {
              navigation.emit({ type: 'tabLongPress', target: route.key })
            }

            const label =
              options.tabBarAccessibilityLabel ??
              (typeof options.title === 'string' ? options.title : route.name)

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={label}
                onPress={onPress}
                onLongPress={onLongPress}
                style={styles.tab}
              >
                <View style={[styles.tabInner, isFocused && styles.tabInnerActive]}>
                  {options.tabBarIcon?.({ focused: isFocused, color, size: 24 })}
                </View>
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: FLOATING_TAB_BAR_HORIZONTAL_INSET,
  },
  pill: {
    height: FLOATING_TAB_BAR_PILL_HEIGHT,
    borderRadius: FLOATING_TAB_BAR_PILL_HEIGHT / 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.45,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
    }),
  },
  pillTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18,18,18,0.55)',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 72,
  },
  tabInner: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 40,
    borderRadius: 20,
  },
  tabInnerActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
})
