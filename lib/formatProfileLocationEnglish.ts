/** Non-English geography labels → English display (legacy profile data). */
const LOCATION_SEGMENT_EN: Record<string, string> = {
  deutschland: 'Germany',
  österreich: 'Austria',
  oesterreich: 'Austria',
  schweiz: 'Switzerland',
  frankreich: 'France',
  italien: 'Italy',
  spanien: 'Spain',
  niederlande: 'Netherlands',
  belgien: 'Belgium',
  polen: 'Poland',
  tschechien: 'Czech Republic',
  'tschechische republik': 'Czech Republic',
  dänemark: 'Denmark',
  daenemark: 'Denmark',
  schweden: 'Sweden',
  norwegen: 'Norway',
  finnland: 'Finland',
  irland: 'Ireland',
  portugal: 'Portugal',
  griechenland: 'Greece',
  ungarn: 'Hungary',
  rumänien: 'Romania',
  rumaenien: 'Romania',
  kroatien: 'Croatia',
  slowenien: 'Slovenia',
  slowakei: 'Slovakia',
  luxemburg: 'Luxembourg',
  'vereinigtes königreich': 'United Kingdom',
  'vereinigtes koenigreich': 'United Kingdom',
  großbritannien: 'United Kingdom',
  grossbritannien: 'United Kingdom',
  england: 'England',
  schottland: 'Scotland',
  wales: 'Wales',
  'vereinigte staaten': 'United States',
  'vereinigte staaten von amerika': 'United States',
  bayern: 'Bavaria',
  sachsen: 'Saxony',
  'nordrhein-westfalen': 'North Rhine-Westphalia',
  'rheinland-pfalz': 'Rhineland-Palatinate',
  'schleswig-holstein': 'Schleswig-Holstein',
  'mecklenburg-vorpommern': 'Mecklenburg-Vorpommern',
  'sachsen-anhalt': 'Saxony-Anhalt',
  thüringen: 'Thuringia',
  thueringen: 'Thuringia',
}

function lookupEnglishSegment(segment: string): string {
  const trimmed = segment.trim()
  if (!trimmed) return trimmed
  const lower = trimmed.toLowerCase()
  return LOCATION_SEGMENT_EN[lower] ?? trimmed
}

/** Format stored profile location for English UI (e.g. "Berlin, Deutschland" → "Berlin, Germany"). */
export function formatProfileLocationEnglish(location: string | null | undefined): string {
  const trimmed = (location ?? '').trim()
  if (!trimmed) return ''

  return trimmed
    .split(',')
    .map((part) => lookupEnglishSegment(part))
    .filter((part) => part.length > 0)
    .join(', ')
}
