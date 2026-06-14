import {
  behanceUrl,
  instagramUrl,
  linkedinUrl,
  normalizeExternalUrl,
  vimeoUrl,
} from '@/lib/profilePublicLinks'
import type { SocialPlatformId } from '@/components/SocialPlatformIcon'

export type ProfileSocialLink = {
  platform: SocialPlatformId
  url: string
  label: string
}

type ProfileSocialFields = {
  portfolio_website?: string | null
  portfolio_instagram?: string | null
  portfolio_linkedin?: string | null
  portfolio_vimeo?: string | null
  portfolio_behance?: string | null
}

export function buildProfileSocialLinks(profile: ProfileSocialFields): ProfileSocialLink[] {
  const entries: { platform: SocialPlatformId; url: string | null; label: string }[] = [
    {
      platform: 'website',
      url: profile.portfolio_website ? normalizeExternalUrl(profile.portfolio_website) : null,
      label: 'Website',
    },
    {
      platform: 'instagram',
      url: instagramUrl(profile.portfolio_instagram ?? ''),
      label: 'Instagram',
    },
    {
      platform: 'linkedin',
      url: linkedinUrl(profile.portfolio_linkedin ?? ''),
      label: 'LinkedIn',
    },
    {
      platform: 'vimeo',
      url: vimeoUrl(profile.portfolio_vimeo ?? ''),
      label: 'Vimeo',
    },
    {
      platform: 'behance',
      url: behanceUrl(profile.portfolio_behance ?? ''),
      label: 'Behance',
    },
  ]
  return entries.filter((x): x is ProfileSocialLink => x.url != null)
}
