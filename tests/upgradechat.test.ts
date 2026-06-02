import { afterEach, describe, expect, it, vi } from 'vitest'
import { upgradechatConnector } from '../src/connectors/adapters/upgradechat.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const UC_BASE = 'https://upgrade.chat.example.com'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_upgradechat_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'upgradechat',
    label: 'upgradechat test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { base_url: UC_BASE },
    credentials: { kind: 'api-key', apiKey: 'uc_secret' },
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

describe('upgradechat adapter manifest', () => {
  it('classifies itself as the crm category and exposes the upgradechat kind', () => {
    expect(upgradechatConnector.manifest.kind).toBe('upgradechat')
    expect(upgradechatConnector.manifest.category).toBe('crm')
    expect(upgradechatConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with an Upgrade.chat-specific hint', () => {
    const auth = upgradechatConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Upgrade\.chat/i)
  })

  it('covers contacts, subscriptions, invoices, and products capability surface (incl. new write-side)', () => {
    const names = upgradechatConnector.manifest.capabilities.map((c) => c.name).sort()
    for (const expected of [
      'contacts.add_or_update',
      'contacts.get',
      'subscriptions.add_or_update',
      'subscriptions.cancel',
      'invoices.create',
      'invoices.refund',
      'products.create',
      'products.update',
      'products.delete',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('marks destructive and write operations as mutations', () => {
    const mutations = upgradechatConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    for (const expected of [
      'contacts.add_or_update',
      'subscriptions.add_or_update',
      'subscriptions.cancel',
      'invoices.create',
      'invoices.refund',
      'products.create',
      'products.update',
      'products.delete',
    ]) {
      expect(mutations).toContain(expected)
    }
  })

  it('marks read-only operations as read', () => {
    const reads = upgradechatConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('contacts.get')
  })

  it('marks every mutation as native-idempotency external-effect', () => {
    const caps = upgradechatConnector.manifest.capabilities
    for (const c of caps) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('upgradechat subscriptions.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/subscriptions/{subscriptionId}/cancel with the reason in body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'sub_1', status: 'cancelled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await upgradechatConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.cancel',
      args: { subscriptionId: 'sub_1', reason: 'customer request' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe(`${UC_BASE}/api/subscriptions/sub_1/cancel`)
    expect(requestBody).toMatchObject({ subscriptionId: 'sub_1', reason: 'customer request' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      upgradechatConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscriptions.cancel',
        args: { subscriptionId: 'sub_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('upgradechat products.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /api/products/{productId} with the patch body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'p_1', name: 'New Name' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await upgradechatConnector.executeMutation!({
      source: source(),
      capabilityName: 'products.update',
      args: { productId: 'p_1', name: 'New Name' },
      idempotencyKey: 'k-2',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe(`${UC_BASE}/api/products/p_1`)
    expect(requestBody).toMatchObject({ productId: 'p_1', name: 'New Name' })
  })
})

describe('upgradechat products.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/products/{productId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await upgradechatConnector.executeMutation!({
      source: source(),
      capabilityName: 'products.delete',
      args: { productId: 'p_1' },
      idempotencyKey: 'k-3',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe(`${UC_BASE}/api/products/p_1`)
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      upgradechatConnector.executeMutation!({
        source: source(),
        capabilityName: 'products.delete',
        args: { productId: 'p_1' },
        idempotencyKey: 'k-3',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('upgradechat invoices.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/invoices/{invoiceId}/refund with the refund body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'inv_1', status: 'refunded' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await upgradechatConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.refund',
      args: { invoiceId: 'inv_1', amount: 25.0, reason: 'duplicate' },
      idempotencyKey: 'k-4',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe(`${UC_BASE}/api/invoices/inv_1/refund`)
    expect(requestBody).toMatchObject({ invoiceId: 'inv_1', amount: 25.0, reason: 'duplicate' })
  })
})
