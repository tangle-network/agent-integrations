import { afterEach, describe, expect, it, vi } from 'vitest'
import { giftbitConnector } from '../src/connectors/adapters/giftbit.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_giftbit_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'giftbit',
    label: 'Giftbit test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'giftbit_secret' },
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

describe('giftbit adapter manifest', () => {
  it('classifies itself as the crm category and exposes the giftbit kind', () => {
    expect(giftbitConnector.manifest.kind).toBe('giftbit')
    expect(giftbitConnector.manifest.category).toBe('crm')
    expect(giftbitConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = giftbitConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the giftbit action set including the campaign + giftcard lifecycle writes', () => {
    const names = giftbitConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'rewards.send',
        'rewards.get',
        'rewards.list',
        'brands.list',
        'campaigns.create',
        'campaigns.send',
        'giftcard.resend',
        'giftcard.cancel',
      ].sort(),
    )
    const reads = giftbitConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = giftbitConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['rewards.get', 'rewards.list', 'brands.list'].sort())
    expect(mutations).toEqual(
      [
        'rewards.send',
        'campaigns.create',
        'campaigns.send',
        'giftcard.resend',
        'giftcard.cancel',
      ].sort(),
    )
  })

  it('marks new mutations as native-idempotent external effect', () => {
    const newMutations = ['campaigns.create', 'campaigns.send', 'giftcard.resend', 'giftcard.cancel']
    for (const name of newMutations) {
      const cap = giftbitConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} should be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('giftbit campaigns.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/campaign with the campaign payload in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'cmp_1', status: 'created' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await giftbitConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.create',
      args: {
        id: 'cmp_1',
        priceInCents: 2500,
        subject: 'Thanks for your help',
        contacts: [{ email: 'drew@example.com', firstName: 'Drew' }],
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.giftbit.com/v1/campaign')
    expect(requestBody).toMatchObject({
      id: 'cmp_1',
      priceInCents: 2500,
      subject: 'Thanks for your help',
      contacts: [{ email: 'drew@example.com', firstName: 'Drew' }],
    })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      giftbitConnector.executeMutation!({
        source: source(),
        capabilityName: 'campaigns.create',
        args: { id: 'cmp_1', priceInCents: 2500 },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('giftbit giftcard.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/gifts/{giftId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'cancelled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await giftbitConnector.executeMutation!({
      source: source(),
      capabilityName: 'giftcard.cancel',
      args: { giftId: 'gift_9' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.giftbit.com/v1/gifts/gift_9')
  })
})

describe('giftbit giftcard.resend', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/gifts/{giftId}/resend', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'resent' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await giftbitConnector.executeMutation!({
      source: source(),
      capabilityName: 'giftcard.resend',
      args: { giftId: 'gift_9' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.giftbit.com/v1/gifts/gift_9/resend')
  })
})
