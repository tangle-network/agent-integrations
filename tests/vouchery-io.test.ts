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
})
