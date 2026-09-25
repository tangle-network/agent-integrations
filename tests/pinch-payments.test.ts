import { afterEach, describe, expect, it, vi } from 'vitest'
import { pinchPaymentsConnector } from '../src/connectors/adapters/pinch-payments.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_pinch_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'pinch-payments',
    label: 'Pinch test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'pinch_secret' },
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

describe('pinch-payments adapter manifest', () => {
  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = pinchPaymentsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})

describe('pinch-payments payments.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/payments/{paymentId}/refunds with the amount/reason body', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'rfnd_1', status: 'pending' })
      }),
    )
    const result = await pinchPaymentsConnector.executeMutation!({
      source: source(),
      capabilityName: 'payments.refund',
      args: { paymentId: 'pay_xyz', amount: 1500, reason: 'duplicate' },
      idempotencyKey: 'idemp-rf-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.pinchpayments.com/v1/payments/pay_xyz/refunds')
    expect(capturedBody).toMatchObject({ amount: 1500, reason: 'duplicate' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      pinchPaymentsConnector.executeMutation!({
        source: source(),
        capabilityName: 'payments.refund',
        args: { paymentId: 'pay_xyz' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('pinch-payments subscriptions.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/subscriptions/{subscriptionId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return new Response(null, { status: 204 })
      }),
    )
    const result = await pinchPaymentsConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.cancel',
      args: { subscriptionId: 'sub_abc' },
      idempotencyKey: 'idemp-sub-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.pinchpayments.com/v1/subscriptions/sub_abc')
    expect(result.status).toBe('committed')
  })
})

describe('pinch-payments payers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/payers/{payerId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return new Response(null, { status: 204 })
      }),
    )
    const result = await pinchPaymentsConnector.executeMutation!({
      source: source(),
      capabilityName: 'payers.delete',
      args: { payerId: 'pyr_xyz' },
      idempotencyKey: 'idemp-pdel-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.pinchpayments.com/v1/payers/pyr_xyz')
    expect(result.status).toBe('committed')
  })
})

describe('pinch-payments sources.remove', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/payers/{payerId}/sources/{sourceId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return new Response(null, { status: 204 })
      }),
    )
    const result = await pinchPaymentsConnector.executeMutation!({
      source: source(),
      capabilityName: 'sources.remove',
      args: { payerId: 'pyr_xyz', sourceId: 'src_abc' },
      idempotencyKey: 'idemp-srm-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.pinchpayments.com/v1/payers/pyr_xyz/sources/src_abc')
    expect(result.status).toBe('committed')
  })
})
