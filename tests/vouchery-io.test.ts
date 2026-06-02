import { afterEach, describe, expect, it, vi } from 'vitest'
import { voucheryIoConnector } from '../src/connectors/adapters/vouchery-io.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_vouchery_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'vouchery-io',
    label: 'Vouchery Test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'vk_test_123',
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

describe('vouchery-io adapter manifest', () => {
  it('classifies itself as the workflow category and exposes the vouchery-io kind', () => {
    expect(voucheryIoConnector.manifest.kind).toBe('vouchery-io')
    expect(voucheryIoConnector.manifest.category).toBe('commerce')
    expect(voucheryIoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = voucheryIoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers find/create plus the redeem/void write surface', () => {
    const names = voucheryIoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'vouchers.find',
        'customers.create',
        'vouchers.create',
        'vouchers.redeem',
        'vouchers.void',
      ].sort(),
    )
    const reads = voucheryIoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = voucheryIoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['vouchers.find'].sort())
    expect(mutations).toEqual(
      [
        'customers.create',
        'vouchers.create',
        'vouchers.redeem',
        'vouchers.void',
      ].sort(),
    )
  })

  it('marks the new write capabilities native-idempotency + externalEffect', () => {
    for (const name of ['vouchers.redeem', 'vouchers.void']) {
      const cap = voucheryIoConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `${name} should be present`).toBeTruthy()
      expect(cap!.class).toBe('mutation')
      if (cap!.class === 'mutation') {
        expect(cap!.cas).toBe('native-idempotency')
        expect(cap!.externalEffect).toBe(true)
      }
    }
  })
})

describe('vouchery-io adapter executeMutation: vouchers.redeem', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /vouchers/{code}/redeem with optional customer_id + amount in the body', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | undefined
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method
      capturedBody = JSON.parse(init!.body as string)
      return jsonResponse({ id: 'redemption-1', code: 'PROMO50', status: 'redeemed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await voucheryIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'vouchers.redeem',
      args: { code: 'PROMO50', customer_id: 'cust_42', amount: 12.5 },
      idempotencyKey: 'idemp-redeem-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/vouchers/PROMO50/redeem')
    expect(capturedBody).toMatchObject({ customer_id: 'cust_42', amount: 12.5 })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(false)
      expect(typeof result.committedAt).toBe('number')
      expect(result.data).toMatchObject({ id: 'redemption-1', code: 'PROMO50', status: 'redeemed' })
    }
  })

  it('rejects when the required `code` arg is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      voucheryIoConnector.executeMutation!({
        source: source(),
        capabilityName: 'vouchers.redeem',
        args: { customer_id: 'cust_42' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/code/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('unauthorized', {
            status: 401,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      voucheryIoConnector.executeMutation!({
        source: source(),
        capabilityName: 'vouchers.redeem',
        args: { code: 'PROMO50', customer_id: 'cust_42', amount: 1 },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('vouchery-io adapter executeMutation: vouchers.void', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /vouchers/{code}/void with optional reason in the body', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | undefined
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method
      capturedBody = JSON.parse(init!.body as string)
      return jsonResponse({ id: 'void-evt-1', code: 'PROMO50', status: 'voided' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await voucheryIoConnector.executeMutation!({
      source: source(),
      capabilityName: 'vouchers.void',
      args: { code: 'PROMO50', reason: 'merchant fraud check' },
      idempotencyKey: 'idemp-void-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/vouchers/PROMO50/void')
    expect(capturedBody).toMatchObject({ reason: 'merchant fraud check' })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(false)
      expect(typeof result.committedAt).toBe('number')
      expect(result.data).toMatchObject({ id: 'void-evt-1', code: 'PROMO50', status: 'voided' })
    }
  })

  it('rejects when the required `code` arg is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      voucheryIoConnector.executeMutation!({
        source: source(),
        capabilityName: 'vouchers.void',
        args: { reason: 'merchant fraud check' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/code/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('forbidden', {
            status: 403,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      voucheryIoConnector.executeMutation!({
        source: source(),
        capabilityName: 'vouchers.void',
        args: { code: 'PROMO50', reason: 'merchant fraud check' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
