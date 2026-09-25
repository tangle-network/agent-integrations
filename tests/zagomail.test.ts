import { afterEach, describe, expect, it, vi } from 'vitest'
import { zagomailConnector } from '../src/connectors/adapters/zagomail.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_zagomail_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'zagomail',
    label: 'zagomail test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'zagomail_secret' },
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

describe('zagomail subscribers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/v1/subscribers/{subscriberUid}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zagomailConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.delete',
      args: { subscriberUid: 'sub_99' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v1/subscribers/sub_99')
    expect(result.status).toBe('committed')
  })
})

describe('zagomail subscribers.unsubscribe', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/subscribers/{subscriberUid}/unsubscribe with the reason body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await zagomailConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.unsubscribe',
      args: { subscriberUid: 'sub_99', reason: 'user requested' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/subscribers/sub_99/unsubscribe')
    expect(requestBody).toMatchObject({ subscriberUid: 'sub_99', reason: 'user requested' })
  })
})

describe('zagomail tags.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/v1/tags/{tagId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zagomailConnector.executeMutation!({
      source: source(),
      capabilityName: 'tags.delete',
      args: { tagId: 'tag_3' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v1/tags/tag_3')
    expect(result.status).toBe('committed')
  })
})

describe('zagomail campaigns.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/campaigns/{campaignId}/send', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'camp_1', status: 'sent' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await zagomailConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.send',
      args: { campaignId: 'camp_1' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/campaigns/camp_1/send')
    expect(requestBody).toMatchObject({ campaignId: 'camp_1' })
  })
})
