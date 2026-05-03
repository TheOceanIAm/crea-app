import type { PublicProfileWidgets } from '@/lib/publicProfileWidgets'

const DODGERS_TEAM_ID = 119

/** Reddit requires a non-empty User-Agent or many clients get 403. */
const FETCH_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'CreaApp/1.0 (contact@creaservices.de)',
} as const

type MlbGame = {
  gameDate?: string
  teams?: {
    away?: { team?: { id?: number; abbreviation?: string; name?: string }; score?: number }
    home?: { team?: { id?: number; abbreviation?: string; name?: string }; score?: number }
  }
  status?: { detailedState?: string }
}

function formatDateShort(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTimeShort(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function matchup(game: MlbGame) {
  const away = game.teams?.away?.team?.abbreviation || game.teams?.away?.team?.name || 'Away'
  const home = game.teams?.home?.team?.abbreviation || game.teams?.home?.team?.name || 'Home'
  return `${away} @ ${home}`
}

function isFinalGame(game: MlbGame) {
  const s = String(game.status?.detailedState || '').toLowerCase()
  return s.includes('final') || s.includes('game over')
}

function resultForDodgers(game: MlbGame) {
  const awayId = game.teams?.away?.team?.id
  const homeId = game.teams?.home?.team?.id
  const awayScore = game.teams?.away?.score
  const homeScore = game.teams?.home?.score
  if (awayScore == null || homeScore == null) return undefined
  const dodgersIsAway = awayId === DODGERS_TEAM_ID
  const dodgersScore = dodgersIsAway ? awayScore : homeScore
  const oppScore = dodgersIsAway ? homeScore : awayScore
  return dodgersScore >= oppScore ? 'W' : 'L'
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: FETCH_HEADERS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as unknown
  } finally {
    clearTimeout(t)
  }
}

function isNonFinalGame(game: MlbGame) {
  const s = String(game.status?.detailedState || '').toLowerCase()
  return !s.includes('final') && !s.includes('game over')
}

/** Today’s top post title from r/UpliftingNews (same source as CEO widget). */
export async function fetchGoodNewsOfTheDayHeadline(): Promise<{ body: string; source: string } | null> {
  try {
    const raw = await fetchJsonWithTimeout(
      'https://www.reddit.com/r/UpliftingNews/top.json?t=day&limit=1&raw_json=1'
    )
    const children = (raw as { data?: { children?: Array<{ data?: { title?: string } }> } })?.data?.children
    const top = Array.isArray(children) ? children[0]?.data : undefined
    const title = typeof top?.title === 'string' ? top.title.trim() : ''
    if (!title) return null
    return { body: title, source: 'Source: r/UpliftingNews' }
  } catch {
    return null
  }
}

async function fetchDodgersLiveWidget(base: PublicProfileWidgets['sports']) {
  if (!base) return null
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - 14)
  const end = new Date(now)
  end.setDate(end.getDate() + 14)
  const startDate = start.toISOString().slice(0, 10)
  const endDate = end.toISOString().slice(0, 10)
  const seasonYear = String(now.getFullYear())

  const [scheduleRaw, standingsRaw] = await Promise.all([
    fetchJsonWithTimeout(
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=${DODGERS_TEAM_ID}&startDate=${startDate}&endDate=${endDate}`
    ),
    fetchJsonWithTimeout(`https://statsapi.mlb.com/api/v1/standings?leagueId=104&season=${seasonYear}`).catch(
      () => null
    ),
  ])

  const dates = Array.isArray((scheduleRaw as { dates?: unknown })?.dates)
    ? ((scheduleRaw as { dates: Array<{ games?: unknown }> }).dates ?? [])
    : []
  const games: MlbGame[] = []
  for (const day of dates) {
    const g = Array.isArray(day.games) ? (day.games as MlbGame[]) : []
    games.push(...g)
  }
  const sorted = games
    .slice()
    .sort((a, b) => new Date(a.gameDate || 0).getTime() - new Date(b.gameDate || 0).getTime())
  const nowTs = now.getTime()
  const lastFinal = sorted
    .filter((g) => isFinalGame(g))
    .filter((g) => new Date(g.gameDate || 0).getTime() <= nowTs)
    .slice(-1)[0]
  const liveOrUpcoming =
    sorted.find((g) => isNonFinalGame(g)) ??
    sorted.find((g) => new Date(g.gameDate || 0).getTime() >= nowTs)

  let wins = base.recordWins
  let losses = base.recordLosses
  const records = Array.isArray((standingsRaw as { records?: unknown })?.records)
    ? ((standingsRaw as { records: Array<{ teamRecords?: unknown }> }).records ?? [])
    : []
  for (const group of records) {
    const teamRecords = Array.isArray(group.teamRecords)
      ? (group.teamRecords as Array<{ team?: { id?: number }; wins?: number; losses?: number }>)
      : []
    const dodgers = teamRecords.find((tr) => tr.team?.id === DODGERS_TEAM_ID)
    if (dodgers) {
      wins = dodgers.wins != null ? `${dodgers.wins}W` : wins
      losses = dodgers.losses != null ? `${dodgers.losses}L` : losses
      break
    }
  }

  return {
    ...base,
    seasonYear,
    recordWins: wins,
    recordLosses: losses,
    lastGame: lastFinal
      ? {
          date: formatDateShort(lastFinal.gameDate),
          matchup: matchup(lastFinal),
          score:
            lastFinal.teams?.away?.score != null && lastFinal.teams?.home?.score != null
              ? `${lastFinal.teams.away.score} - ${lastFinal.teams.home.score}`
              : base.lastGame.score,
          result: resultForDodgers(lastFinal) ?? base.lastGame.result,
        }
      : base.lastGame,
    nextGame: liveOrUpcoming
      ? {
          date: formatDateShort(liveOrUpcoming.gameDate),
          matchup: matchup(liveOrUpcoming),
          time: formatTimeShort(liveOrUpcoming.gameDate),
        }
      : base.nextGame,
  }
}

async function fetchGoodNewsLiveWidget(base: PublicProfileWidgets['goodNews']) {
  if (!base) return null
  const headline = await fetchGoodNewsOfTheDayHeadline()
  if (!headline) return base
  return {
    kicker: 'GOOD NEWS OF THE DAY',
    body: headline.body,
    source: headline.source,
  }
}

export async function loadLiveCeoWidgets(base: PublicProfileWidgets): Promise<PublicProfileWidgets> {
  try {
    const [sports, goodNews] = await Promise.all([
      fetchDodgersLiveWidget(base.sports).catch(() => base.sports),
      fetchGoodNewsLiveWidget(base.goodNews).catch(() => base.goodNews),
    ])
    return {
      sports: sports ?? base.sports,
      goodNews: goodNews ?? base.goodNews,
    }
  } catch {
    return base
  }
}

