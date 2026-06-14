import { Platform } from 'react-native'

/** Width at which we treat the layout as tablet-class (iPad portrait, large Android). */
export const TABLET_BREAKPOINT = 768

/** Max content width on tablet — main tab screens and lists. */
export const TABLET_CONTENT_MAX_WIDTH = 720

/** Narrower column for forms, auth, and profile text. */
export const TABLET_COMPACT_MAX_WIDTH = 480

/** Wider column for future split-view / two-pane layouts. */
export const TABLET_WIDE_MAX_WIDTH = 960

export type ResponsiveContentVariant = 'default' | 'compact' | 'wide'

export function isTabletWidth(windowWidth: number): boolean {
  return windowWidth >= TABLET_BREAKPOINT
}

/** Native iPad even before first layout pass (e.g. split view edge cases). */
export function isTabletDevice(): boolean {
  return Platform.OS === 'ios' && Platform.isPad === true
}

export function resolveContentMaxWidth(
  windowWidth: number,
  variant: ResponsiveContentVariant = 'default',
): number | undefined {
  if (!isTabletWidth(windowWidth)) return undefined
  switch (variant) {
    case 'compact':
      return TABLET_COMPACT_MAX_WIDTH
    case 'wide':
      return TABLET_WIDE_MAX_WIDTH
    default:
      return TABLET_CONTENT_MAX_WIDTH
  }
}

export function resolveHorizontalPadding(windowWidth: number, phone = 20, tablet = 24): number {
  return isTabletWidth(windowWidth) ? tablet : phone
}

/** For ScrollView `contentContainerStyle` — gradual migration helper. */
export function responsiveScrollContentStyle(
  windowWidth: number,
  variant: ResponsiveContentVariant = 'default',
  extra?: { paddingHorizontal?: number; paddingBottom?: number },
) {
  const maxWidth = resolveContentMaxWidth(windowWidth, variant)
  return {
    paddingHorizontal: extra?.paddingHorizontal ?? resolveHorizontalPadding(windowWidth),
    ...(extra?.paddingBottom != null ? { paddingBottom: extra.paddingBottom } : {}),
    ...(maxWidth != null
      ? { maxWidth, alignSelf: 'center' as const, width: '100%' as const }
      : {}),
  }
}

export function isLandscapeWindow(windowWidth: number, windowHeight: number): boolean {
  return windowWidth > windowHeight
}

/** Work grid columns on phone — 3 square tiles per row. Tablet uses a horizontal carousel instead. */
export function resolvePublicProfileWorkColumns(_windowWidth: number, isTablet: boolean): number {
  return isTablet ? 3 : 3
}

export function workGridTileWidthPercent(columns: number): `${number}%` {
  if (columns === 2) return '49%'
  if (columns <= 3) return '32.5%'
  if (columns === 4) return '24%'
  if (columns === 5) return '19%'
  return '16%'
}

/** Fixed carousel tile width so exactly three 16:9 previews fit in the viewport. */
export function publicProfileWorkCarouselTileWidth(viewportWidth: number, gap = 10): number {
  const safe = Math.max(viewportWidth, 280)
  return Math.floor((safe - gap * 2) / 3)
}

/** Thumbnail aspect ratio — square on phone, 16:9 landscape on tablet. */
export function publicProfileWorkThumbAspectRatio(isTablet: boolean): number {
  return isTablet ? 16 / 9 : 1
}
