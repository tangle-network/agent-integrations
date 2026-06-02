import { afterEach, describe, expect, it, vi } from 'vitest'
import { saasticConnector } from '../src/connectors/adapters/saastic.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_saastic_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'saastic',
    label: 'saastic test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'saastic_secret' },
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

describe('saastic adapter manifest', () => {
  it('classifies itself as the crm category and exposes the saastic kind', () => {
    expect(saasticConnector.manifest.kind).toBe('saastic')
    expect(saasticConnector.manifest.category).toBe('crm')
    expect(saasticConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = saasticConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Saastic/i)
  })

  it('covers customer, charge, and subscription capability surfaces', () => {
    const names = saasticConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'customers.create',
        'customers.get',
        'customers.list',
        'customers.update',
        'customers.delete',
        'charges.create',
        'charges.refund',
        'subscriptions.cancel',
      ].sort(),
    )
    const mutations = saasticConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'customers.create',
        'customers.update',
        'customers.delete',
        'charges.create',
        'charges.refund',
        'subscriptions.cancel',
      ].sort(),
    )
  })

  it('marks all mutations as native-idempotency external-effect', () => {
    for (const c of saasticConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('saastic customers.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/customers/{email} with the supplied fields', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? String(init.body) : ''
      return jsonResponse({ email: 'a@b.com', first_name: 'New' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await saasticConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.update',
      args: { email: 'a@b.com', first_name: 'New', phone: '+15551112222' },
      idempotencyKey: 'k-upd',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.saastic.com/v1/customers/a%40b.com')
    expect(JSON.parse(requestBody)).toMatchObject({ first_name: 'New', phone: '+15551112222' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      saasticConnector.executeMutation!({
        source: source(),
        capabilityName: 'customers.update',
        args: { email: 'a@b.com' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('saastic customers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/customers/{email}', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await saasticConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.delete',
      args: { email: 'a@b.com' },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.saastic.com/v1/customers/a%40b.com')
    expect(result.status).toBe('committed')
  })
})

describe('saastic charges.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/charges/{chargeId}/refund with optional amount in the body', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? String(init.body) : ''
      return jsonResponse({ id: 'ch_1', refunded: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await saasticConnector.executeMutation!({
      source: source(),
      capabilityName: 'charges.refund',
      args: { chargeId: 'ch_1', amount: 999 },
      idempotencyKey: 'k-refund',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.saastic.com/v1/charges/ch_1/refund')
    expect(JSON.parse(requestBody)).toMatchObject({ amount: 999 })
    expect(result.status).toBe('committed')
  })
})

describe('saastic subscriptions.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/subscriptions/{subscriptionId}/cancel', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ id: 'sub_1', status: 'canceled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await saasticConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.cancel',
      args: { subscriptionId: 'sub_1' },
      idempotencyKey: 'k-cancel',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.saastic.com/v1/subscriptions/sub_1/cancel')
    expect(result.status).toBe('committed')
  })
})
