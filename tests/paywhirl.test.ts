import { afterEach, describe, expect, it, vi } from 'vitest'
import { paywhirlConnector } from '../src/connectors/adapters/paywhirl.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_paywhirl_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'paywhirl',
    label: 'paywhirl test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { apiSecret: 'paywhirl_api_secret' },
    credentials: { kind: 'api-key', apiKey: 'paywhirl_api_key' },
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

describe('paywhirl adapter manifest', () => {
  it('classifies itself as the crm category and exposes the paywhirl kind', () => {
    expect(paywhirlConnector.manifest.kind).toBe('paywhirl')
    expect(paywhirlConnector.manifest.category).toBe('crm')
    expect(paywhirlConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = paywhirlConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Paywhirl|API/i)
  })

  it('covers the catalog plus the new write-side mutations', () => {
    const names = paywhirlConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'customers.create',
        'customers.get',
        'customers.search',
        'customers.update',
        'customers.delete',
        'invoices.create',
        'subscriptions.cancel',
        'subscriptions.create',
        'subscriptions.pause',
        'subscriptions.search',
      ].sort(),
    )
    const mutations = paywhirlConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'customers.create',
        'customers.update',
        'customers.delete',
        'invoices.create',
        'subscriptions.cancel',
        'subscriptions.create',
        'subscriptions.pause',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    for (const cap of paywhirlConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas, `mutation ${cap.name} cas`).toBe('native-idempotency')
      expect(cap.externalEffect, `mutation ${cap.name} externalEffect`).toBe(true)
    }
  })
})

describe('paywhirl customers.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /v1/customers/{customerId} with api_key + api_secret query params', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      return jsonResponse({ id: 42, first_name: 'New' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await paywhirlConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.update',
      args: { customerId: '42', firstName: 'New' },
      idempotencyKey: 'k-update',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/v1/customers/42')
    expect(String(requestUrl)).toContain('api_key=paywhirl_api_key')
    expect(requestBody).toMatchObject({ customerId: '42', firstName: 'New' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      paywhirlConnector.executeMutation!({
        source: source(),
        capabilityName: 'customers.update',
        args: { customerId: '42', firstName: 'New' },
        idempotencyKey: 'k-update',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('paywhirl customers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/customers/{customerId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await paywhirlConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.delete',
      args: { customerId: '42' },
      idempotencyKey: 'k-del',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/customers/42')
    expect(String(requestUrl)).toContain('api_key=paywhirl_api_key')
  })
})

describe('paywhirl invoices.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/invoices with the body args', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      return jsonResponse({ id: 'inv_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await paywhirlConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.create',
      args: { customerId: '42', amount: 19.99, currency: 'USD' },
      idempotencyKey: 'k-inv',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/invoices')
    expect(requestBody).toMatchObject({ customerId: '42', amount: 19.99, currency: 'USD' })
  })
})

describe('paywhirl subscriptions.pause', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/subscriptions/{subscriptionId}/pause', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ paused: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await paywhirlConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.pause',
      args: { subscriptionId: 7 },
      idempotencyKey: 'k-pause',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/subscriptions/7/pause')
    expect(String(requestUrl)).toContain('api_key=paywhirl_api_key')
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      paywhirlConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscriptions.pause',
        args: { subscriptionId: 7 },
        idempotencyKey: 'k-pause',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
