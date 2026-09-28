import { afterEach, describe, expect, it, vi } from 'vitest'
import { kudosityConnector } from '../src/connectors/adapters/kudosity.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_kudosity_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'kudosity',
    label: 'kudosity test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'kudosity_secret' },
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

describe('kudosity contact.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the contact to the add-to-list endpoint', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 12345, msisdn: '+15551112222' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kudosityConnector.executeMutation!({
      source: source(),
      capabilityName: 'contact.create',
      args: {
        listId: '987',
        msisdn: '+15551112222',
        email: 'alice@example.com',
        firstName: 'Alice',
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('api.transmitsms.com/add-to-list.json')
    expect(requestBody).toBeDefined()
    const parsed = JSON.parse(requestBody as string) as Record<string, unknown>
    expect(parsed.list_id).toBe('987')
    expect(parsed.msisdn).toBe('+15551112222')
    expect(parsed.email).toBe('alice@example.com')
  })
})

describe('kudosity contact.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the update through the upsert endpoint', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kudosityConnector.executeMutation!({
      source: source(),
      capabilityName: 'contact.update',
      args: { listId: '1', msisdn: '+15551112222', firstName: 'Bob' },
      idempotencyKey: 'k-2',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/add-to-list.json')
  })
})
