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
  it('classifies itself as the crm category and exposes the pinch-payments kind', () => {
    expect(pinchPaymentsConnector.manifest.kind).toBe('pinch-payments')
    expect(pinchPaymentsConnector.manifest.category).toBe('crm')
    expect(pinchPaymentsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = pinchPaymentsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus the write-side additions', () => {
    const names = pinchPaymentsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'payers.create-or-update',
        'payers.find',
        'payers.delete',
        'sources.add-to-payer',
        'sources.remove',
        'payments.create-realtime',
        'payments.create-or-update-scheduled',
        'payments.refund',
        'subscriptions.create-or-update',
        'subscriptions.find',
        'subscriptions.cancel',
        'events.find',
      ].sort(),
    )
    const reads = pinchPaymentsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['events.find', 'payers.find', 'subscriptions.find'].sort())
  })

  it('marks every new mutation as native-idempotency + externalEffect', () => {
    const writeSide = [
      'payments.refund',
      'subscriptions.cancel',
      'payers.delete',
      'sources.remove',
    ]
    for (const name of writeSide) {
      const cap = pinchPaymentsConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
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
