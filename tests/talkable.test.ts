import { afterEach, describe, expect, it, vi } from 'vitest'
import { talkableConnector } from '../src/connectors/adapters/talkable.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_talkable_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'talkable',
    label: 'talkable test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'talkable_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('talkable adapter manifest', () => {
  it('classifies itself as the crm category and exposes the talkable kind', () => {
    expect(talkableConnector.manifest.kind).toBe('talkable')
    expect(talkableConnector.manifest.category).toBe('crm')
    expect(talkableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = talkableConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full advocates / referrals / rewards / campaigns / events / offers action set including write-side capabilities', () => {
    const names = talkableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'advocates.list',
        'advocates.get',
        'advocates.update',
        'advocates.delete',
        'referrals.list',
        'referrals.create',
        'referrals.update',
        'rewards.list',
        'rewards.issue',
        'campaigns.list',
        'events.track',
        'offers.list',
      ].sort(),
    )
    const reads = talkableConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = talkableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['advocates.list', 'advocates.get', 'referrals.list', 'rewards.list', 'campaigns.list', 'offers.list'].sort(),
    )
    expect(mutations).toEqual(
      [
        'advocates.update',
        'advocates.delete',
        'referrals.create',
        'referrals.update',
        'rewards.issue',
        'events.track',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    for (const cap of talkableConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('talkable advocates.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /sites/{site}/advocates/{email} with the advocate envelope', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ advocate: { email: 'a@b.com' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await talkableConnector.executeMutation!({
      source: source(),
      capabilityName: 'advocates.update',
      args: {
        site: 'site_x',
        email: 'a@b.com',
        advocate: { first_name: 'Alice', custom_properties: { tier: 'gold' } },
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/sites/site_x/advocates/')
    expect(String(requestUrl)).toContain('a%40b.com')
    expect(requestBody).toMatchObject({ advocate: { first_name: 'Alice' } })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      talkableConnector.executeMutation!({
        source: source(),
        capabilityName: 'advocates.update',
        args: { site: 'site_x', email: 'a@b.com', advocate: { first_name: 'A' } },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('talkable advocates.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /sites/{site}/advocates/{email}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await talkableConnector.executeMutation!({
      source: source(),
      capabilityName: 'advocates.delete',
      args: { site: 'site_x', email: 'a@b.com' },
      idempotencyKey: 'k-2',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/sites/site_x/advocates/')
  })
})

describe('talkable referrals.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /sites/{site}/referrals/{referralId} with the new state', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ referral: { id: 'ref_1', state: 'approved' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await talkableConnector.executeMutation!({
      source: source(),
      capabilityName: 'referrals.update',
      args: { site: 'site_x', referralId: 'ref_1', state: 'approved' },
      idempotencyKey: 'k-3',
    })

    expect(String(requestUrl)).toContain('/sites/site_x/referrals/ref_1')
    expect(requestBody).toMatchObject({ state: 'approved' })
  })
})

describe('talkable rewards.issue', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /sites/{site}/rewards with the advocate email and offer id', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ reward: { id: 'r_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await talkableConnector.executeMutation!({
      source: source(),
      capabilityName: 'rewards.issue',
      args: { site: 'site_x', email: 'a@b.com', offerId: 'offer_1' },
      idempotencyKey: 'k-4',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/sites/site_x/rewards')
    expect(requestBody).toMatchObject({ email: 'a@b.com', offer_id: 'offer_1' })
  })
})
