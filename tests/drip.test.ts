import { afterEach, describe, expect, it, vi } from 'vitest'
import { dripConnector } from '../src/connectors/adapters/drip.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_drip_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'drip',
    label: 'Drip test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'drip_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  const bodyAllowed = status !== 204 && status !== 205 && status !== 304
  return new Response(bodyAllowed ? JSON.stringify(body) : null, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('drip adapter manifest', () => {
  it('classifies itself as the crm category and exposes the drip kind', () => {
    expect(dripConnector.manifest.kind).toBe('drip')
    expect(dripConnector.manifest.category).toBe('crm')
    expect(dripConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = dripConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full action set (campaign add, tag, upsert, delete, events)', () => {
    const names = dripConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'subscribers.add_to_campaign',
        'subscribers.apply_tag',
        'subscribers.upsert',
        'subscribers.delete',
        'events.record',
      ].sort(),
    )
    const reads = dripConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = dripConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual([])
    expect(mutations).toEqual(
      [
        'subscribers.add_to_campaign',
        'subscribers.apply_tag',
        'subscribers.upsert',
        'subscribers.delete',
        'events.record',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency externalEffect (where added in this batch)', () => {
    const newCaps = dripConnector.manifest.capabilities.filter((c) =>
      c.name === 'subscribers.delete' || c.name === 'events.record',
    )
    expect(newCaps).toHaveLength(2)
    for (const c of newCaps) {
      if (c.class !== 'mutation') throw new Error(`${c.name} must be a mutation`)
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('drip subscribers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE against /accounts/{account_id}/subscribers/{id_or_email}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await dripConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.delete',
      args: { account_id: 'acct_1', id_or_email: 'drew@example.com' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe(
      'https://api.getdrip.com/v3/accounts/acct_1/subscribers/drew%40example.com',
    )
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      dripConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscribers.delete',
        args: { account_id: 'acct_1', id_or_email: 'drew@example.com' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('drip events.record', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the event body wrapped under events: [...]', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'evt_1' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await dripConnector.executeMutation!({
      source: source(),
      capabilityName: 'events.record',
      args: {
        account_id: 'acct_1',
        email: 'drew@example.com',
        action: 'Purchased a product',
        properties: { sku: 'sku_1' },
        occurred_at: '2026-06-02T10:00:00Z',
      },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.getdrip.com/v3/accounts/acct_1/events')
    expect(requestBody).toMatchObject({
      events: [
        {
          email: 'drew@example.com',
          action: 'Purchased a product',
          properties: { sku: 'sku_1' },
          occurred_at: '2026-06-02T10:00:00Z',
        },
      ],
    })
  })
})
