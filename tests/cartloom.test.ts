import { afterEach, describe, expect, it, vi } from 'vitest'
import { cartloomConnector } from '../src/connectors/adapters/cartloom.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_cartloom_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'cartloom',
    label: 'Cartloom test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl: 'https://store.example.com/api' },
    credentials: { kind: 'api-key', apiKey: 'cartloom_secret' },
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

describe('cartloom adapter manifest', () => {
  it('classifies itself as the crm category and exposes the cartloom kind', () => {
    expect(cartloomConnector.manifest.kind).toBe('cartloom')
    expect(cartloomConnector.manifest.category).toBe('crm')
    expect(cartloomConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = cartloomConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('includes the new write capabilities alongside the existing ones', () => {
    const names = cartloomConnector.manifest.capabilities.map((c) => c.name)
    for (const expected of [
      'discounts.create',
      'discounts.update',
      'discounts.delete',
      'discounts.get',
      'discounts.list',
      'orders.get',
      'orders.listByDate',
      'orders.searchByEmail',
      'orders.refund',
      'products.list',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('marks the new write capabilities as native-idempotency external effect', () => {
    const targets = ['discounts.update', 'discounts.delete', 'orders.refund']
    for (const name of targets) {
      const cap = cartloomConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('cartloom discounts.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  const fullArgs = {
    discountId: 'd1',
    title: 'Spring 10',
    enabled: true,
    auto: false,
    unlimited: true,
    selfDestruct: false,
    applyOnce: true,
    type: 'percent',
    amount: 10,
    target: 'product',
    startDate: '2026-06-01',
    stopDate: '2026-12-31',
    code: 'SPRING10',
    targetPids: ['p1'],
    targetAmount: 0,
    targetQuantity: 0,
    allowance: 100,
  }

  it('PUTs /discounts/{id} with the updateable fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'd1' })
      }),
    )
    const result = await cartloomConnector.executeMutation!({
      source: source(),
      capabilityName: 'discounts.update',
      args: fullArgs,
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/discounts/d1')
    expect(requestBody).toMatchObject({ title: 'Spring 10', enabled: true, amount: 10, code: 'SPRING10' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      cartloomConnector.executeMutation!({
        source: source(),
        capabilityName: 'discounts.update',
        args: fullArgs,
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('cartloom discounts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /discounts/{id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({})
      }),
    )
    const result = await cartloomConnector.executeMutation!({
      source: source(),
      capabilityName: 'discounts.delete',
      args: { discountId: 'd1' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/discounts/d1')
    expect(result.status).toBe('committed')
  })
})

describe('cartloom orders.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /orders/{invoice}/refund with amount/reason body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ ok: true })
      }),
    )
    const result = await cartloomConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.refund',
      args: { invoice: 'inv-1', amount: 9.99, reason: 'duplicate' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/orders/inv-1/refund')
    expect(requestBody).toEqual({ amount: 9.99, reason: 'duplicate' })
    expect(result.status).toBe('committed')
  })
})
