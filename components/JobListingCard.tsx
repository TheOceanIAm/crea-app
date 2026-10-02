import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { formatJobListingMeta } from '@/lib/jobListingMeta'

type Props = {
  companyName: string
  companyLogoUrl?: string | null
  title: string
  location?: string | null
  locationType?: string | null
  startDate?: string | null
  budgetType?: string | null
  budgetAmount?: number | null
  budgetCurrency?: string | null
  onPress: () => void
}

function companyInitial(name: string) {
  const t = name.trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}

/** Compact job posting. The whole card opens the job. */
export function JobListingCard({
  companyName,
  companyLogoUrl,
  title,
  location,
  locationType,
  startDate,
  budgetType,
  budgetAmount,
  budgetCurrency,
  onPress,
}: Props) {
  const meta = formatJobListingMeta({
    location,
    locationType,
    startDate,
    budgetType,
    budgetAmount,
    budgetCurrency,
  })
  const logo = companyLogoUrl?.trim()

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.86} onPress={onPress}>
      <View style={styles.companyRow}>
        {logo ? (
          <Image source={{ uri: logo }} style={styles.logo} />
        ) : (
          <View style={styles.logoFallback}>
            <Text style={styles.logoLetter}>{companyInitial(companyName)}</Text>
          </View>
        )}
        <Text style={styles.companyName} numberOfLines={1}>
          {companyName}
        </Text>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111111',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  logoFallback: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,220,0,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,220,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: {
    color: '#FFDC00',
    fontSize: 12,
    fontWeight: '800',
  },
  companyName: {
    flex: 1,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    marginTop: 8,
    color: '#ffffff',
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  meta: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.38)',
    fontSize: 12,
    lineHeight: 16,
  },
})
