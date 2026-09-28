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
