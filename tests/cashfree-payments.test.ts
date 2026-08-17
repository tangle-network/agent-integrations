import { afterEach, describe, expect, it, vi } from 'vitest'
import { cashfreePaymentsConnector } from '../src/connectors/adapters/cashfree-payments.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(baseUrl = 'https://api.cashfree.com/pg'): ResolvedDataSource {
  return {
    id: 'src_cashfree_1',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'cashfree-payments',
    label: 'Cashfree test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl },
    credentials: {
      kind: 'custom',
      values: { clientId: 'cashfree-client', clientSecret: 'cashfree-secret' },
    },
    status: 'active',
  }
}

describe('cashfree-payments adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the cashfree-payments kind', () => {
    expect(cashfreePaymentsConnector.manifest.kind).toBe('cashfree-payments')
    expect(cashfreePaymentsConnector.manifest.category).toBe('commerce')
    expect(cashfreePaymentsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = cashfreePaymentsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: orders + links + refunds + cashgrams', () => {
    const names = cashfreePaymentsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'cashgrams.create',
        'cashgrams.deactivate',
        'orders.create',
        'orders.refunds.list',
        'payment_links.cancel',
        'payment_links.create',
        'payment_links.get',
        'payment_links.orders.list',
        'refunds.create',
      ].sort(),
    )
    const reads = cashfreePaymentsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = cashfreePaymentsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['orders.refunds.list', 'payment_links.get', 'payment_links.orders.list'])
    expect(mutations).toEqual(
      [
        'cashgrams.create',
        'cashgrams.deactivate',
        'orders.create',
        'payment_links.cancel',
        'payment_links.create',
        'refunds.create',
      ].sort(),
    )
  })
})

describe('cashfree credential and endpoint boundaries', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends both credentials as headers to an official endpoint', async () => {
    let headers = new Headers()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Headers(init?.headers)
      return new Response(JSON.stringify({ refunds: [] }), {
        headers: { 'content-type': 'application/json' },
      })
    }))

    await cashfreePaymentsConnector.executeRead!({
      source: source('https://sandbox.cashfree.com/pg'),
      capabilityName: 'orders.refunds.list',
      args: { orderId: 'order_1' },
      idempotencyKey: 'read_1',
    })

    expect(headers.get('x-client-id')).toBe('cashfree-client')
    expect(headers.get('x-client-secret')).toBe('cashfree-secret')
  })

  it('rejects an unapproved endpoint before sending credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(cashfreePaymentsConnector.executeRead!({
      source: source('https://cashfree.attacker.test/pg'),
      capabilityName: 'orders.refunds.list',
      args: { orderId: 'order_1' },
      idempotencyKey: 'read_2',
    })).rejects.toThrow('not an allowed provider endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
