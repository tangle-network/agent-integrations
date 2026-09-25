import { afterEach, describe, expect, it, vi } from 'vitest'
import { wufooConnector } from '../src/connectors/adapters/wufoo.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_wufoo_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'wufoo',
    label: 'wufoo test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'wufoo_secret' },
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

describe('wufoo entries.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /forms/{formHash}/entries/{entryId}.json with the data payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ EntryId: '12' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await wufooConnector.executeMutation!({
      source: source(),
      capabilityName: 'entries.update',
      args: {
        formHash: 'abc123',
        entryId: '12',
        data: { Field1: 'updated' },
      },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(requestUrl).toBe('https://{subdomain}.wufoo.com/api/v3/forms/abc123/entries/12.json')
    expect(requestBody).toEqual({ Field1: 'updated' })
  })
})

describe('wufoo entries.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /forms/{formHash}/entries/{entryId}.json', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await wufooConnector.executeMutation!({
      source: source(),
      capabilityName: 'entries.delete',
      args: { formHash: 'abc123', entryId: '12' },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://{subdomain}.wufoo.com/api/v3/forms/abc123/entries/12.json')
  })
})

describe('wufoo webhooks.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /forms/{formHash}/webhooks.json with the target url', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ WebHookPutResult: { Hash: 'wh_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await wufooConnector.executeMutation!({
      source: source(),
      capabilityName: 'webhooks.create',
      args: {
        formHash: 'abc123',
        url: 'https://example.com/hook',
      },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('PUT')
    expect(requestUrl).toBe('https://{subdomain}.wufoo.com/api/v3/forms/abc123/webhooks.json')
    expect(requestBody).toMatchObject({ url: 'https://example.com/hook' })
  })
})

describe('wufoo webhooks.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /forms/{formHash}/webhooks/{webhookHash}.json', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await wufooConnector.executeMutation!({
      source: source(),
      capabilityName: 'webhooks.delete',
      args: { formHash: 'abc123', webhookHash: 'wh_1' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://{subdomain}.wufoo.com/api/v3/forms/abc123/webhooks/wh_1.json')
  })
})
