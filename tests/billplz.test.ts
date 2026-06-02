import { afterEach, describe, expect, it, vi } from 'vitest'
import { billplzConnector } from '../src/connectors/adapters/billplz.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_billplz_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'billplz',
    label: 'Drew Billplz',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'bp-secret',
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

describe('billplz adapter manifest', () => {
  it('classifies itself in the commerce category and exposes the billplz kind', () => {
    expect(billplzConnector.manifest.kind).toBe('billplz')
    expect(billplzConnector.manifest.category).toBe('commerce')
    expect(billplzConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = billplzConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers reads + mutations including cancel.bill and create.refund', () => {
    const names = billplzConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['cancel.bill', 'create.bill', 'create.refund', 'get.bill'])

    const reads = billplzConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = billplzConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.bill'])
    expect(mutations).toEqual(['cancel.bill', 'create.bill', 'create.refund'])
  })

  it('marks new mutations with native-idempotency CAS and external effect', () => {
    const caps = billplzConnector.manifest.capabilities
    const cancel = caps.find((c) => c.name === 'cancel.bill')!
    const refund = caps.find((c) => c.name === 'create.refund')!
    expect(cancel.class).toBe('mutation')
    expect(refund.class).toBe('mutation')
    if (cancel.class !== 'mutation' || refund.class !== 'mutation') return
    expect(cancel.cas).toBe('native-idempotency')
    expect(cancel.externalEffect).toBe(true)
    expect(refund.cas).toBe('native-idempotency')
    expect(refund.externalEffect).toBe(true)
  })
})

describe('billplz cancel.bill', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends DELETE /v3/bills/{id} and returns a committed mutation result', async () => {
    let requestMethod: string | undefined
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'bill-123' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await billplzConnector.executeMutation!({
      source: source(),
      capabilityName: 'cancel.bill',
      args: { id: 'bill-123' },
      idempotencyKey: 'idemp-cancel-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toContain('/v3/bills/bill-123')
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') return
    expect(result.idempotentReplay).toBe(false)
    expect(typeof result.committedAt).toBe('number')
    expect(result.data).toMatchObject({ id: 'bill-123' })
  })

  it('rejects when required `id` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      billplzConnector.executeMutation!({
        source: source(),
        capabilityName: 'cancel.bill',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: id/)
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
      billplzConnector.executeMutation!({
        source: source(),
        capabilityName: 'cancel.bill',
        args: { id: 'bill-123' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('billplz create.refund', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs /v3/refunds with bill_id, amount, reason and returns committed', async () => {
    let requestMethod: string | undefined
    let requestUrl: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'refund-1', bill_id: 'bill-123', amount: 200, state: 'pending' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await billplzConnector.executeMutation!({
      source: source(),
      capabilityName: 'create.refund',
      args: { bill_id: 'bill-123', amount: 200, reason: 'duplicate-charge' },
      idempotencyKey: 'idemp-refund-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toContain('/v3/refunds')
    expect(requestBody).toEqual({
      bill_id: 'bill-123',
      amount: 200,
      reason: 'duplicate-charge',
    })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') return
    expect(result.idempotentReplay).toBe(false)
    expect(typeof result.committedAt).toBe('number')
    expect(result.data).toMatchObject({ id: 'refund-1', bill_id: 'bill-123', amount: 200 })
  })

  it('rejects when required `bill_id` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      billplzConnector.executeMutation!({
        source: source(),
        capabilityName: 'create.refund',
        args: { amount: 200, reason: 'r' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: bill_id/)
  })

  it('rejects when required `amount` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      billplzConnector.executeMutation!({
        source: source(),
        capabilityName: 'create.refund',
        args: { bill_id: 'bill-123', reason: 'r' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: amount/)
  })

  it('rejects when required `reason` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      billplzConnector.executeMutation!({
        source: source(),
        capabilityName: 'create.refund',
        args: { bill_id: 'bill-123', amount: 200 },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: reason/)
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
      billplzConnector.executeMutation!({
        source: source(),
        capabilityName: 'create.refund',
        args: { bill_id: 'bill-123', amount: 200, reason: 'r' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
