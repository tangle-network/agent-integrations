import { afterEach, describe, expect, it, vi } from 'vitest'
import { gameballConnector } from '../src/connectors/adapters/gameball.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_gameball_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'gameball',
    label: 'Gameball test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'gb-secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('gameball adapter manifest', () => {
  it('exposes the gameball kind and classifies under other', () => {
    expect(gameballConnector.manifest.kind).toBe('gameball')
    expect(gameballConnector.manifest.category).toBe('other')
    expect(gameballConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = gameballConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: send.event plus player/action/reward writes', () => {
    const names = gameballConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['action.track', 'player.create', 'reward.redeem', 'send.event'].sort(),
    )
    const mutations = gameballConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['action.track', 'player.create', 'reward.redeem', 'send.event'].sort(),
    )
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const cap of gameballConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('gameball player.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /integrations/player with the upsert payload and apiKey header', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    let requestHeaders: Record<string, string> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      requestHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      return jsonResponse({ playerUniqueId: 'cust_1', referralCode: 'XYZ' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gameballConnector.executeMutation!({
      source: source(),
      capabilityName: 'player.create',
      args: {
        playerUniqueId: 'cust_1',
        playerAttributes: { email: 'drew@example.com', displayName: 'Drew' },
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.gameball.co/api/v3.0/integrations/player')
    expect(requestHeaders.apikey ?? requestHeaders.apiKey).toBe('gb-secret')
    expect(requestBody).toMatchObject({
      playerUniqueId: 'cust_1',
      playerAttributes: { email: 'drew@example.com', displayName: 'Drew' },
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      gameballConnector.executeMutation!({
        source: source(),
        capabilityName: 'player.create',
        args: { playerUniqueId: 'cust_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('gameball action.track', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /integrations/event with the action map', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gameballConnector.executeMutation!({
      source: source(),
      capabilityName: 'action.track',
      args: {
        playerUniqueId: 'cust_1',
        events: { review_left: { rating: 5 } },
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toBe('https://api.gameball.co/api/v3.0/integrations/event')
    expect(requestBody).toMatchObject({
      playerUniqueId: 'cust_1',
      events: { review_left: { rating: 5 } },
    })
  })
})

describe('gameball reward.redeem', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /integrations/redeem with the reward constraints', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ redeemed: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gameballConnector.executeMutation!({
      source: source(),
      capabilityName: 'reward.redeem',
      args: {
        playerUniqueId: 'cust_1',
        rewardConstraints: { rewardId: 'rw_42' },
        transactionId: 'txn_99',
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toBe('https://api.gameball.co/api/v3.0/integrations/redeem')
    expect(requestBody).toMatchObject({
      playerUniqueId: 'cust_1',
      rewardConstraints: { rewardId: 'rw_42' },
      transactionId: 'txn_99',
    })
  })
})
