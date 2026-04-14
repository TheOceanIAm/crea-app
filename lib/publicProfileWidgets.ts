/**
 * Optional JSON on profiles.public_profile_widgets for the public CEO profile layout.
 * Merge with defaults so partial JSON in Supabase is enough.
 */

export type SportsGameRow = {
  date: string
  matchup: string
  score?: string
  result?: string
  time?: string
}

export type SportsWidgetConfig = {
  team: string
  seasonYear?: string
  recordWins?: string
  recordLosses?: string
  scheduleUrl?: string | null
  scheduleLabel?: string
  lastGame: SportsGameRow
  nextGame: SportsGameRow
}

export type GoodNewsWidgetConfig = {
  kicker: string
  body: string
  source?: string
}

export type PublicProfileWidgets = {
  sports: SportsWidgetConfig | null
  goodNews: GoodNewsWidgetConfig | null
}

export const DEFAULT_CEO_PUBLIC_WIDGETS: PublicProfileWidgets = {
  sports: {
    team: 'LA Dodgers',
    seasonYear: '2026',
    recordWins: '12W',
    recordLosses: '4L',
    scheduleUrl: 'https://www.mlb.com/dodgers/schedule',
    scheduleLabel: 'SCHEDULE →',
    lastGame: {
      date: 'Tue, Apr 14',
      matchup: 'NYM @ LAD',
      score: '0 – 4',
      result: 'W',
    },
    nextGame: {
      date: 'Wed, Apr 15',
      matchup: 'NYM @ LAD',
      time: '04:10 AM',
    },
  },
  goodNews: {
    kicker: 'GOOD NEWS OF THE DAY',
    body: 'Over 50 countries now include the right to a clean environment in their constitution.',
    source: 'Source: UN',
  },
}

function pickGame(raw: unknown): SportsGameRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const date = typeof o.date === 'string' ? o.date : ''
  const matchup = typeof o.matchup === 'string' ? o.matchup : ''
  if (!date && !matchup) return null
  return {
    date,
    matchup,
    score: typeof o.score === 'string' ? o.score : undefined,
    result: typeof o.result === 'string' ? o.result : undefined,
    time: typeof o.time === 'string' ? o.time : undefined,
  }
}

function parseSports(raw: unknown): SportsWidgetConfig | null {
  if (raw === null) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_CEO_PUBLIC_WIDGETS.sports
  const o = raw as Record<string, unknown>
  const team = typeof o.team === 'string' ? o.team : DEFAULT_CEO_PUBLIC_WIDGETS.sports!.team
  const last = pickGame(o.lastGame) ?? DEFAULT_CEO_PUBLIC_WIDGETS.sports!.lastGame
  const next = pickGame(o.nextGame) ?? DEFAULT_CEO_PUBLIC_WIDGETS.sports!.nextGame
  const def = DEFAULT_CEO_PUBLIC_WIDGETS.sports!
  return {
    team,
    seasonYear: typeof o.seasonYear === 'string' ? o.seasonYear : def.seasonYear,
    recordWins: typeof o.recordWins === 'string' ? o.recordWins : def.recordWins,
    recordLosses: typeof o.recordLosses === 'string' ? o.recordLosses : def.recordLosses,
    scheduleUrl: typeof o.scheduleUrl === 'string' ? o.scheduleUrl : o.scheduleUrl === null ? null : def.scheduleUrl,
    scheduleLabel: typeof o.scheduleLabel === 'string' ? o.scheduleLabel : def.scheduleLabel,
    lastGame: last,
    nextGame: next,
  }
}

function parseGoodNews(raw: unknown): GoodNewsWidgetConfig | null {
  if (raw === null) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_CEO_PUBLIC_WIDGETS.goodNews
  const o = raw as Record<string, unknown>
  const body = typeof o.body === 'string' ? o.body : DEFAULT_CEO_PUBLIC_WIDGETS.goodNews!.body
  return {
    kicker: typeof o.kicker === 'string' ? o.kicker : DEFAULT_CEO_PUBLIC_WIDGETS.goodNews!.kicker,
    body,
    source: typeof o.source === 'string' ? o.source : DEFAULT_CEO_PUBLIC_WIDGETS.goodNews!.source,
  }
}

export function parsePublicProfileWidgets(raw: unknown): PublicProfileWidgets {
  if (raw == null) return DEFAULT_CEO_PUBLIC_WIDGETS
  if (typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_CEO_PUBLIC_WIDGETS
  const o = raw as Record<string, unknown>
  return {
    sports: o.sports === undefined ? DEFAULT_CEO_PUBLIC_WIDGETS.sports : parseSports(o.sports),
    goodNews: o.goodNews === undefined ? DEFAULT_CEO_PUBLIC_WIDGETS.goodNews : parseGoodNews(o.goodNews),
  }
}
