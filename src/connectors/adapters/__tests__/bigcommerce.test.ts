import { afterEach, describe, expect, it, vi } from 'vitest'
import { bigcommerceConnector } from '../bigcommerce.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_bigcommerce',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'bigcommerce',
  label: 'BigCommerce (Acme)',
  consistencyModel: 'authoritative',
  scopes: ['store_v2_products', 'store_v2_orders'],
  metadata: { apiBaseUrl: 'https://api.bigcommerce.com/stores/abc123' },
  credentials: { kind: 'oauth2', accessToken: 'token_abc' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('bigcommerce adapter manifest', () => {
  it('declares the expected OAuth2 endpoints, scopes, and env-var names', () => {
    const auth = bigcommerceConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://login.bigcommerce.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://login.bigcommerce.com/oauth2/token')
    expect(auth.scopes).toEqual([
      'store_v2_products',
      'store_v2_orders',
      'store_v2_customers_read_only',
      'store_v2_information_read_only',
    ])
    expect(auth.clientIdEnv).toBe('BIGCOMMERCE_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('BIGCOMMERCE_OAUTH_CLIENT_SECRET')
  })

  it('exposes the commerce action pack (products + orders) split between reads and mutations', () => {
    const names = bigcommerceConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'products.search',
        'products.get',
        'products.create',
        'products.update',
        'products.delete',
        'orders.search',
        'orders.get',
        'orders.update',
        'orders.refund',
        'customers.create',
        'customers.update',
      ].sort(),
    )
    const reads = bigcommerceConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    const mutations = bigcommerceConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name)
    expect(reads.sort()).toEqual(['orders.get', 'orders.search', 'products.get', 'products.search'])
    expect(mutations.sort()).toEqual([
      'customers.create',
      'customers.update',
      'orders.refund',
      'orders.update',
      'products.create',
      'products.delete',
      'products.update',
    ])
  })

  it('classifies itself as commerce with authoritative consistency', () => {
    expect(bigcommerceConnector.manifest.kind).toBe('bigcommerce')
    expect(bigcommerceConnector.manifest.category).toBe('commerce')
    expect(bigcommerceConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })
})

describe('bigcommerce adapter execution', () => {
  it('targets the per-store apiBaseUrl with X-Auth-Token (not Bearer) and interpolates query filters', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: 77, name: 'T-shirt' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'products.search',
      args: { name: 'shirt', limit: 50 },
      idempotencyKey: 'idem_1',
    }
    const result = await bigcommerceConnector.executeRead!(invocation)

    expect(result.data).toEqual({ data: [{ id: 77, name: 'T-shirt' }] })
    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe('https://api.bigcommerce.com/stores/abc123/v3/catalog/products?name%3Alike=shirt&limit=50')
    const headers = call[1]!.headers as Record<string, string>
    expect(headers['X-Auth-Token']).toBe('token_abc')
    expect(headers.authorization).toBeUndefined()
  })

  it('commits PUT mutations against the store-scoped v2 orders path with the renamed body', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 1001, status_id: 10 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'orders.update',
      args: { orderId: 1001, fields: { status_id: 10, staff_notes: 'shipped' } },
      idempotencyKey: 'idem_2',
    }
    const result = await bigcommerceConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe('https://api.bigcommerce.com/stores/abc123/v2/orders/1001')
    expect(call[1]!.method).toBe('PUT')
    expect(JSON.parse(String(call[1]!.body))).toEqual({ status_id: 10, staff_notes: 'shipped' })
  })

  it('throws CredentialsExpired when BigCommerce rejects the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'orders.get',
      args: { orderId: 5 },
      idempotencyKey: 'idem_3',
    }
    await expect(bigcommerceConnector.executeRead!(invocation)).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('fails fast when metadata.apiBaseUrl is missing (cannot resolve store-scoped base URL)', async () => {
    const noBaseSource: ResolvedDataSource = { ...source, metadata: {} }
    const invocation: ConnectorInvocation = {
      source: noBaseSource,
      capabilityName: 'products.get',
      args: { productId: 1 },
      idempotencyKey: 'idem_4',
    }
    await expect(bigcommerceConnector.executeRead!(invocation)).rejects.toThrow(/apiBaseUrl/)
  })
})
