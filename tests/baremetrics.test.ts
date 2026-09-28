import { afterEach, describe, expect, it, vi } from 'vitest'
import { baremetricsConnector } from '../src/connectors/adapters/baremetrics.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_baremetrics_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'baremetrics',
    label: 'Baremetrics test',
    consistencyModel: 'authoritative',
    scopes: ['write'],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bm-token' },
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

describe('baremetrics delete.customer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/{sourceId}/customers/{customerOid}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let authorization: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      authorization = new Headers(init?.headers).get('authorization') ?? undefined
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await baremetricsConnector.executeMutation!({
      source: source(),
      capabilityName: 'delete.customer',
      args: { sourceId: 'src_abc', customerOid: 'cust_42' },
      idempotencyKey: 'k-del-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/src_abc/customers/cust_42')
    expect(authorization).toBe('Bearer bm-token')
    expect(result.status).toBe('committed')
  })
})

describe('baremetrics cancel.subscription', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/{sourceId}/subscriptions/{subscriptionOid}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ canceled: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await baremetricsConnector.executeMutation!({
      source: source(),
      capabilityName: 'cancel.subscription',
      args: { sourceId: 'src_abc', subscriptionOid: 'sub_99' },
      idempotencyKey: 'k-cancel-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/src_abc/subscriptions/sub_99')
    expect(result.status).toBe('committed')
  })
})

describe('baremetrics create.annotation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/annotations with metric/title/date body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'ann_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await baremetricsConnector.executeMutation!({
      source: source(),
      capabilityName: 'create.annotation',
      args: {
        metric: 'mrr',
        title: 'Launch',
        description: 'product launch',
        date: '2026-06-01',
      },
      idempotencyKey: 'k-ann-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/annotations')
    expect(requestBody).toMatchObject({ metric: 'mrr', title: 'Launch', date: '2026-06-01' })
    expect(result.status).toBe('committed')
  })

  it('rejects when required `metric` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      baremetricsConnector.executeMutation!({
        source: source(),
        capabilityName: 'create.annotation',
        args: { title: 'Launch', description: 'd', date: '2026-06-01' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: metric/)
  })
})
