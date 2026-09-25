import { afterEach, describe, expect, it, vi } from 'vitest'
import { lemonSqueezyConnector } from '../src/connectors/adapters/lemon-squeezy.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_lemon_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'lemon-squeezy',
    label: 'Drew Store',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'ls_test_key',
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

describe('lemon-squeezy adapter manifest', () => {
  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = lemonSqueezyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})

describe('lemon-squeezy subscriptions.cancel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('issues DELETE /v1/subscriptions/{id} with bearer credentials and returns the response payload', async () => {
    let seenUrl = ''
    let seenMethod = ''
    let seenAuth: string | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input)
      seenMethod = init?.method ?? 'GET'
      const headers = new Headers(init?.headers as HeadersInit)
      seenAuth = headers.get('authorization')
      return jsonResponse({
        data: {
          type: 'subscriptions',
          id: 'sub_123',
          attributes: { status: 'cancelled' },
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await lemonSqueezyConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.cancel',
      args: { id: 'sub_123' },
      idempotencyKey: 'idemp-cancel-1',
    })
    expect(seenMethod).toBe('DELETE')
    expect(seenUrl).toMatch(/api\.lemonsqueezy\.com\/(?:v1\/)?subscriptions\/sub_123$/)
    expect(seenAuth).toBe('Bearer ls_test_key')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { data: { id: string } }).data.id).toBe('sub_123')
    }
  })

  it('rejects missing `id`', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      lemonSqueezyConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscriptions.cancel',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: id/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('unauthorized', {
          status: 401,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    )
    await expect(
      lemonSqueezyConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscriptions.cancel',
        args: { id: 'sub_123' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('lemon-squeezy orders.issueRefund', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('issues POST /v1/orders/{id}/refund with JSON:API envelope and forwards `amount` (cents)', async () => {
    let seenUrl = ''
    let seenMethod = ''
    let seenBody: { data: { type: string; attributes: { amount?: number } } } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input)
      seenMethod = init?.method ?? 'GET'
      seenBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({
        data: {
          type: 'refunds',
          id: 'ref_abc',
          attributes: { status: 'refunded' },
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await lemonSqueezyConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.issueRefund',
      args: { id: 'ord_42', amount: 250 },
      idempotencyKey: 'idemp-refund-1',
    })
    expect(seenMethod).toBe('POST')
    expect(seenUrl).toMatch(/api\.lemonsqueezy\.com\/(?:v1\/)?orders\/ord_42\/refund$/)
    expect(seenBody!.data.type).toBe('refunds')
    expect(seenBody!.data.attributes.amount).toBe(250)
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { data: { id: string } }).data.id).toBe('ref_abc')
    }
  })

  it('rejects missing `id` (path arg)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      lemonSqueezyConnector.executeMutation!({
        source: source(),
        capabilityName: 'orders.issueRefund',
        args: { amount: 100 },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: id/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('forbidden', {
          status: 403,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    )
    await expect(
      lemonSqueezyConnector.executeMutation!({
        source: source(),
        capabilityName: 'orders.issueRefund',
        // pass amount so the JSON:API body renders past the renderer's required-template check
        args: { id: 'ord_42', amount: 100 },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
