import { afterEach, describe, expect, it, vi } from 'vitest'
import { chessComConnector } from '../src/connectors/adapters/chess-com.js'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  resolveConnectorAdapterFactoryOptions,
} from '../src/connectors/adapters/factories.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/index.js'

const source: ResolvedDataSource = {
  id: 'chess_1',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'chess-com',
  label: 'Chess.com public API',
  consistencyModel: 'cache',
  scopes: [],
  metadata: {},
  credentials: { kind: 'none' },
  status: 'active',
}

function invocation(capabilityName: string, args: Record<string, unknown> = {}) {
  return { source, capabilityName, args, idempotencyKey: `chess-${capabilityName}` }
}

describe('Chess.com provider pack', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ships 24 safe read operations and is executable without a deployment secret', () => {
    expect(validateConnectorManifest(chessComConnector.manifest)).toEqual({ ok: true, issues: [] })
    expect(chessComConnector.manifest.auth).toEqual({ kind: 'none' })
    expect(chessComConnector.manifest.capabilities).toHaveLength(24)
    expect(chessComConnector.manifest.capabilities.every((capability) => capability.class === 'read')).toBe(true)
    expect(getIntegrationSpec('chess-com')?.status).toBe('executable')

    const definition = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === 'chess-com')
    expect(definition?.envMap).toEqual({})
    expect(resolveConnectorAdapterFactoryOptions(definition!, {})).toEqual({})
    expect(definition?.factory({})).toBe(chessComConnector)
  })

  it.each([
    ['get.player.profile', { username: 'Hikaru' }, '/pub/player/hikaru'],
    ['get.player.stats', { username: 'Hikaru' }, '/pub/player/hikaru/stats'],
    ['player.monthly-games', { username: 'Hikaru', year: 2026, month: 7 }, '/pub/player/hikaru/games/2026/07'],
    ['players.titled', { title: 'gm' }, '/pub/titled/GM'],
    ['country.players', { country: 'us' }, '/pub/country/US/players'],
    ['club.members', { club: 'chess-com-developer-community' }, '/pub/club/chess-com-developer-community/members'],
    ['tournament.group', { tournament: 'daily-960', round: 3, group: 9 }, '/pub/tournament/daily-960/3/9'],
  ])('routes %s to the fixed public API host', async (capabilityName, args, path) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: 'etag-1' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await chessComConnector.executeRead!(invocation(capabilityName as string, args as Record<string, unknown>))

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`https://api.chess.com${path}`)
    expect(result).toMatchObject({ data: { ok: true }, etag: 'etag-1' })
  })

  it('returns monthly PGN as text with the correct accept header', async () => {
    let accept = ''
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      accept = ((init?.headers ?? {}) as Record<string, string>).accept!
      return new Response('[Event "Live Chess"]\n1. e4 e5 *', {
        status: 200,
        headers: { 'content-type': 'application/x-chess-pgn' },
      })
    }))

    const result = await chessComConnector.executeRead!(invocation('player.monthly-pgn', {
      username: 'Hikaru',
      year: 2026,
      month: 7,
    }))

    expect(accept).toContain('application/x-chess-pgn')
    expect(result.data).toContain('1. e4 e5')
  })

  it('rejects path injection and invalid calendar values before network access', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(chessComConnector.executeRead!(invocation('get.player.profile', {
      username: '../../etc/passwd',
    }))).rejects.toThrow(/invalid Chess.com path value/)
    await expect(chessComConnector.executeRead!(invocation('player.monthly-games', {
      username: 'Hikaru',
      year: 2026,
      month: 13,
    }))).rejects.toThrow(/month must be an integer/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces upstream errors and malformed JSON without reporting success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"missing"}', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })))
    await expect(chessComConnector.executeRead!(invocation('get.player.profile', {
      username: 'not-a-player',
    }))).rejects.toThrow(/404.*missing/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{broken', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    await expect(chessComConnector.executeRead!(invocation('get.daily.puzzle'))).rejects.toThrow(/malformed JSON/)
  })

  it('rejects an oversized response before buffering its body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(5 * 1024 * 1024 + 1),
      },
    })))

    await expect(chessComConnector.executeRead!(invocation('leaderboards.get'))).rejects.toThrow(/response exceeds/)
  })

  it('checks the public API without credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await expect(chessComConnector.test(source)).resolves.toEqual({ ok: true })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    await expect(chessComConnector.test(source)).resolves.toEqual({
      ok: false,
      reason: 'Chess.com public API returned 429',
    })
  })
})
