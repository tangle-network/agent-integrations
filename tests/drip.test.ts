import { afterEach, describe, expect, it, vi } from 'vitest'
import { dripConnector } from '../src/connectors/adapters/drip.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_drip_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'drip',
    label: 'Drip test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'drip_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  const bodyAllowed = status !== 204 && status !== 205 && status !== 304
  return new Response(bodyAllowed ? JSON.stringify(body) : null, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('drip subscribers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE against /accounts/{account_id}/subscribers/{id_or_email}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await dripConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.delete',
      args: { account_id: 'acct_1', id_or_email: 'drew@example.com' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe(
      'https://api.getdrip.com/v3/accounts/acct_1/subscribers/drew%40example.com',
    )
  })
})

describe('drip events.record', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the event body wrapped under events: [...]', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'evt_1' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await dripConnector.executeMutation!({
      source: source(),
      capabilityName: 'events.record',
      args: {
        account_id: 'acct_1',
        email: 'drew@example.com',
        action: 'Purchased a product',
        properties: { sku: 'sku_1' },
        occurred_at: '2026-06-02T10:00:00Z',
      },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.getdrip.com/v3/accounts/acct_1/events')
    expect(requestBody).toMatchObject({
      events: [
        {
          email: 'drew@example.com',
          action: 'Purchased a product',
          properties: { sku: 'sku_1' },
          occurred_at: '2026-06-02T10:00:00Z',
        },
      ],
    })
  })
})
