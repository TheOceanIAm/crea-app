import { FontAwesome5 } from '@expo/vector-icons'
import type { ComponentProps } from 'react'

export type SocialPlatformId = 'website' | 'instagram' | 'linkedin' | 'vimeo' | 'behance'

type Fa5Name = ComponentProps<typeof FontAwesome5>['name']

const BRAND_ICONS: Record<Exclude<SocialPlatformId, 'website'>, Fa5Name> = {
  instagram: 'instagram',
  linkedin: 'linkedin-in',
  vimeo: 'vimeo-v',
  behance: 'behance',
}

type Props = {
  platform: SocialPlatformId
  size?: number
  color?: string
}

/** Recognizable platform icons for public profile social links. */
export function SocialPlatformIcon({ platform, size = 18, color = '#FFDC00' }: Props) {
  if (platform === 'website') {
    return <FontAwesome5 name="globe" size={size} color={color} />
  }
  return <FontAwesome5 name={BRAND_ICONS[platform]} size={size} color={color} brand />
}
