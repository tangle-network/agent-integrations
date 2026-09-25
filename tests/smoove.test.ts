import { afterEach, describe, expect, it, vi } from 'vitest'
import { smooveConnector } from '../src/connectors/adapters/smoove.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_smoove_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'smoove',
    label: 'smoove test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'smoove_secret' },
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

describe('smoove subscribers.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /v1/subscribers/{id} with the data object as the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'sub_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smooveConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.update',
      args: { id: 'sub_1', data: { firstName: 'Alice', lastName: 'Smith' } },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PUT')
    expect(requestUrl).toBe('https://api.smoove.io/v1/subscribers/sub_1')
    expect(requestBody).toMatchObject({ firstName: 'Alice', lastName: 'Smith' })
    expect(result.status).toBe('committed')
  })
})

describe('smoove subscribers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/subscribers/{id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smooveConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.delete',
      args: { id: 'sub_77' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.smoove.io/v1/subscribers/sub_77')
    expect(result.status).toBe('committed')
  })
})

describe('smoove lists.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/lists/{id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await smooveConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.delete',
      args: { id: 'list_5' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.smoove.io/v1/lists/list_5')
  })
})

describe('smoove campaigns.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/campaigns/{id}/send', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await smooveConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.send',
      args: { id: 'camp_1' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.smoove.io/v1/campaigns/camp_1/send')
  })
})
