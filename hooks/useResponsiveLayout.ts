import { useWindowDimensions } from 'react-native'
import {
  isTabletDevice,
  isTabletWidth,
  resolveContentMaxWidth,
  resolveHorizontalPadding,
  type ResponsiveContentVariant,
} from '@/lib/responsiveLayout'

export function useResponsiveLayout(variant: ResponsiveContentVariant = 'default') {
  const { width, height } = useWindowDimensions()
  const isTablet = isTabletWidth(width) || isTabletDevice()

  return {
    windowWidth: width,
    windowHeight: height,
    isTablet,
    contentMaxWidth: resolveContentMaxWidth(width, variant),
    horizontalPadding: resolveHorizontalPadding(width),
  }
}
