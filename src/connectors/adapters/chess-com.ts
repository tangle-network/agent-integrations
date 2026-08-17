import {
  type Capability,
  type CapabilityReadResult,
  type ConnectorAdapter,
  type ConnectorInvocation,
} from '../types.js'

const API_ORIGIN = 'https://api.chess.com'
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,25}$/
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,100}$/
const TITLES = ['GM', 'WGM', 'IM', 'WIM', 'FM', 'WFM', 'NM', 'WNM', 'CM', 'WCM'] as const

const usernameProperty = {
  type: 'string',
  description: 'Chess.com username, without a profile URL.',
  pattern: USERNAME_PATTERN.source,
}
const slugProperty = {
  type: 'string',
  description: 'Chess.com URL id (the final path segment of the public page URL).',
  pattern: SLUG_PATTERN.source,
}

const CAPABILITIES: Capability[] = [
  readCapability('get.player.profile', 'Get the public profile for a Chess.com player.', { username: usernameProperty }, ['username']),
  readCapability('get.player.stats', 'Get ratings and game statistics for a Chess.com player.', { username: usernameProperty }, ['username']),
  readCapability('player.current-games', 'List a player’s currently ongoing daily games.', { username: usernameProperty }, ['username']),
  readCapability('player.game-archives', 'List the monthly game archive URLs available for a player.', { username: usernameProperty }, ['username']),
  readCapability('player.monthly-games', 'Get a player’s games for one calendar month as structured JSON.', {
    username: usernameProperty,
    year: { type: 'integer', minimum: 2007, maximum: 2100 },
    month: { type: 'integer', minimum: 1, maximum: 12 },
  }, ['username', 'year', 'month']),
  readCapability('player.monthly-pgn', 'Get a player’s games for one calendar month as a PGN document.', {
    username: usernameProperty,
    year: { type: 'integer', minimum: 2007, maximum: 2100 },
    month: { type: 'integer', minimum: 1, maximum: 12 },
  }, ['username', 'year', 'month']),
  readCapability('player.clubs', 'List the public clubs a player belongs to.', { username: usernameProperty }, ['username']),
  readCapability('player.matches', 'List a player’s current and finished team matches.', { username: usernameProperty }, ['username']),
  readCapability('player.tournaments', 'List a player’s current, registered, and finished tournaments.', { username: usernameProperty }, ['username']),
  readCapability('get.daily.puzzle', 'Get the current Chess.com daily puzzle.', {}),
  readCapability('puzzle.random', 'Get a random Chess.com puzzle.', {}),
  readCapability('players.titled', 'List usernames holding a FIDE or national chess title.', {
    title: { type: 'string', enum: [...TITLES] },
  }, ['title']),
  readCapability('leaderboards.get', 'Get current Chess.com leaderboards.', {}),
  readCapability('streamers.list', 'List Chess.com streamers and their public channels.', {}),
  readCapability('country.get', 'Get public information for a country.', {
    country: { type: 'string', description: 'Two-letter ISO 3166 country code.', pattern: '^[A-Za-z]{2}$' },
  }, ['country']),
  readCapability('country.players', 'List Chess.com players registered to a country.', {
    country: { type: 'string', description: 'Two-letter ISO 3166 country code.', pattern: '^[A-Za-z]{2}$' },
  }, ['country']),
  readCapability('country.clubs', 'List Chess.com clubs registered to a country.', {
    country: { type: 'string', description: 'Two-letter ISO 3166 country code.', pattern: '^[A-Za-z]{2}$' },
  }, ['country']),
  readCapability('club.get', 'Get public information for a Chess.com club.', { club: slugProperty }, ['club']),
  readCapability('club.members', 'List members of a Chess.com club, grouped by activity.', { club: slugProperty }, ['club']),
  readCapability('club.matches', 'List a Chess.com club’s current and finished team matches.', { club: slugProperty }, ['club']),
  readCapability('club.admins', 'List public administrators for a Chess.com club.', { club: slugProperty }, ['club']),
  readCapability('tournament.get', 'Get public details for a Chess.com tournament.', { tournament: slugProperty }, ['tournament']),
  readCapability('tournament.round', 'Get one round of a Chess.com tournament.', {
    tournament: slugProperty,
    round: { type: 'integer', minimum: 1 },
  }, ['tournament', 'round']),
  readCapability('tournament.group', 'Get one group within a Chess.com tournament round.', {
    tournament: slugProperty,
    round: { type: 'integer', minimum: 1 },
    group: { type: 'integer', minimum: 1 },
  }, ['tournament', 'round', 'group']),
]

export const chessComConnector: ConnectorAdapter = {
  manifest: {
    kind: 'chess-com',
    displayName: 'Chess.com',
    description:
      'Read public Chess.com profiles, ratings, games, puzzles, leaderboards, clubs, countries, tournaments, and streaming data without credentials.',
    auth: { kind: 'none' },
    category: 'other',
    defaultConsistencyModel: 'cache',
    rateLimit: { requests: 60, windowMs: 60_000, scope: 'data-source' },
    capabilities: CAPABILITIES,
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const path = route(inv.capabilityName, inv.args)
    const response = await fetch(`${API_ORIGIN}${path}`, {
      method: 'GET',
      headers: {
        accept: inv.capabilityName === 'player.monthly-pgn'
          ? 'application/x-chess-pgn, text/plain;q=0.9'
          : 'application/json',
        'user-agent': 'Tangle-Integrations/1.0 (+https://tangle.tools)',
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
    const body = await readBoundedBody(response)
    if (!response.ok) {
      const detail = body.length > 200 ? `${body.slice(0, 200)}…` : body
      throw new Error(`Chess.com ${inv.capabilityName} failed: ${response.status} ${detail || response.statusText}`)
    }
    return {
      data: parseBody(body, response.headers.get('content-type')),
      etag: response.headers.get('etag') ?? response.headers.get('last-modified') ?? undefined,
      fetchedAt: Date.now(),
    }
  },

  async test() {
    try {
      const response = await fetch(`${API_ORIGIN}/pub/leaderboards`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'Tangle-Integrations/1.0 (+https://tangle.tools)',
        },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      })
      return response.ok
        ? { ok: true }
        : { ok: false, reason: `Chess.com public API returned ${response.status}` }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  },
}

function readCapability(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): Capability {
  return {
    name,
    class: 'read',
    description,
    parameters: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    },
  }
}

function route(capabilityName: string, args: Record<string, unknown>): string {
  const username = () => segment(args.username, 'username', USERNAME_PATTERN)
  const club = () => segment(args.club, 'club', SLUG_PATTERN)
  const tournament = () => segment(args.tournament, 'tournament', SLUG_PATTERN)
  switch (capabilityName) {
    case 'get.player.profile': return `/pub/player/${username()}`
    case 'get.player.stats': return `/pub/player/${username()}/stats`
    case 'player.current-games': return `/pub/player/${username()}/games/current`
    case 'player.game-archives': return `/pub/player/${username()}/games/archives`
    case 'player.monthly-games': return `/pub/player/${username()}/games/${integer(args.year, 'year', 2007, 2100)}/${month(args.month)}`
    case 'player.monthly-pgn': return `/pub/player/${username()}/games/${integer(args.year, 'year', 2007, 2100)}/${month(args.month)}/pgn`
    case 'player.clubs': return `/pub/player/${username()}/clubs`
    case 'player.matches': return `/pub/player/${username()}/matches`
    case 'player.tournaments': return `/pub/player/${username()}/tournaments`
    case 'get.daily.puzzle': return '/pub/puzzle'
    case 'puzzle.random': return '/pub/puzzle/random'
    case 'players.titled': return `/pub/titled/${title(args.title)}`
    case 'leaderboards.get': return '/pub/leaderboards'
    case 'streamers.list': return '/pub/streamers'
    case 'country.get': return `/pub/country/${country(args.country)}`
    case 'country.players': return `/pub/country/${country(args.country)}/players`
    case 'country.clubs': return `/pub/country/${country(args.country)}/clubs`
    case 'club.get': return `/pub/club/${club()}`
    case 'club.members': return `/pub/club/${club()}/members`
    case 'club.matches': return `/pub/club/${club()}/matches`
    case 'club.admins': return `/pub/club/${club()}/admin`
    case 'tournament.get': return `/pub/tournament/${tournament()}`
    case 'tournament.round': return `/pub/tournament/${tournament()}/${integer(args.round, 'round', 1, 1_000_000)}`
    case 'tournament.group': return `/pub/tournament/${tournament()}/${integer(args.round, 'round', 1, 1_000_000)}/${integer(args.group, 'group', 1, 1_000_000)}`
    default: throw new Error(`Chess.com does not support capability ${capabilityName}`)
  }
}

function segment(value: unknown, label: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label} has an invalid Chess.com path value`)
  }
  return encodeURIComponent(value.toLowerCase())
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function month(value: unknown): string {
  return String(integer(value, 'month', 1, 12)).padStart(2, '0')
}

function country(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z]{2}$/.test(value)) {
    throw new Error('country must be a two-letter ISO 3166 code')
  }
  return value.toUpperCase()
}

function title(value: unknown): string {
  if (typeof value !== 'string' || !TITLES.includes(value.toUpperCase() as typeof TITLES[number])) {
    throw new Error(`title must be one of ${TITLES.join(', ')}`)
  }
  return value.toUpperCase()
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Chess.com response exceeds ${MAX_RESPONSE_BYTES} bytes`)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error(`Chess.com response exceeds ${MAX_RESPONSE_BYTES} bytes`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function parseBody(body: string, contentType: string | null): unknown {
  if (body.length === 0) return null
  if (contentType?.includes('json')) {
    try {
      return JSON.parse(body)
    } catch {
      throw new Error('Chess.com returned malformed JSON')
    }
  }
  return body
}
