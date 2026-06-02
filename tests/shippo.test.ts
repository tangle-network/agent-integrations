import { afterEach, describe, expect, it, vi } from 'vitest'
import { shippoConnector } from '../src/connectors/adapters/shippo.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_shippo_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'shippo',
    label: 'Drew Shippo',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'shippo-secret',
    },
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

describe('shippo adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the shippo kind', () => {
    expect(shippoConnector.manifest.kind).toBe('shippo')
    expect(shippoConnector.manifest.category).toBe('commerce')
    expect(shippoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = shippoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Shippo/i)
  })

  it('covers orders, shipping labels, transactions, and tracks capability surface', () => {
    const names = shippoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['orders.create', 'orders.find', 'shippinglabels.find', 'tracks.get', 'transactions.create'].sort(),
    )
    const mutations = shippoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['orders.create', 'transactions.create'])
  })

  it('marks transactions.create with native-idempotency CAS and external effect', () => {
    const tx = shippoConnector.manifest.capabilities.find((c) => c.name === 'transactions.create')!
    expect(tx.class).toBe('mutation')
    if (tx.class !== 'mutation') return
    expect(tx.cas).toBe('native-idempotency')
    expect(tx.externalEffect).toBe(true)
  })
})

describe('shippo transactions.create', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs /v1/transactions with rate/label_file_type/async and returns committed', async () => {
    let requestMethod: string | undefined
    let requestUrl: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({
        object_id: 'txn-1',
        status: 'SUCCESS',
        tracking_number: '9400111899223197428490',
        tracking_url_provider: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490',
        label_url: 'https://shippo-delivery.s3.amazonaws.com/label.pdf',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await shippoConnector.executeMutation!({
      source: source(),
      capabilityName: 'transactions.create',
      args: { rate: 'rate-abc', label_file_type: 'PDF', async: false },
      idempotencyKey: 'idemp-txn-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toContain('/v1/transactions')
    expect(requestBody).toEqual({
      rate: 'rate-abc',
      label_file_type: 'PDF',
      async: false,
    })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') return
    expect(result.idempotentReplay).toBe(false)
    expect(typeof result.committedAt).toBe('number')
    expect(result.data).toMatchObject({
      object_id: 'txn-1',
      status: 'SUCCESS',
      tracking_number: '9400111899223197428490',
      label_url: 'https://shippo-delivery.s3.amazonaws.com/label.pdf',
    })
  })

  it('rejects when required `rate` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      shippoConnector.executeMutation!({
        source: source(),
        capabilityName: 'transactions.create',
        args: { label_file_type: 'PDF', async: false },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: rate/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    await expect(
      shippoConnector.executeMutation!({
        source: source(),
        capabilityName: 'transactions.create',
        args: { rate: 'rate-abc', label_file_type: 'PDF', async: false },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('shippo tracks.get', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /v1/tracks/{carrier}/{tracking_number} and returns tracking status', async () => {
    let requestMethod: string | undefined
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({
        carrier: 'usps',
        tracking_number: '9400111899223197428490',
        tracking_status: { status: 'TRANSIT', status_details: 'Package in transit' },
        tracking_history: [
          { status: 'PRE_TRANSIT', status_date: '2026-05-30T10:00:00Z' },
          { status: 'TRANSIT', status_date: '2026-05-31T08:15:00Z' },
        ],
        eta: '2026-06-03T12:00:00Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await shippoConnector.executeRead!({
      source: source(),
      capabilityName: 'tracks.get',
      args: { carrier: 'usps', tracking_number: '9400111899223197428490' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('GET')
    expect(requestUrl).toContain('/v1/tracks/usps/9400111899223197428490')
    expect(typeof result.fetchedAt).toBe('number')
    expect(result.data).toMatchObject({
      carrier: 'usps',
      tracking_number: '9400111899223197428490',
      eta: '2026-06-03T12:00:00Z',
    })
  })

  it('rejects when required `carrier` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      shippoConnector.executeRead!({
        source: source(),
        capabilityName: 'tracks.get',
        args: { tracking_number: '9400111899223197428490' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: carrier/)
  })

  it('rejects when required `tracking_number` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      shippoConnector.executeRead!({
        source: source(),
        capabilityName: 'tracks.get',
        args: { carrier: 'usps' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: tracking_number/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'forbidden' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    await expect(
      shippoConnector.executeRead!({
        source: source(),
        capabilityName: 'tracks.get',
        args: { carrier: 'usps', tracking_number: '9400111899223197428490' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
