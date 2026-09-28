import { afterEach, describe, expect, it, vi } from 'vitest'
import { crispConnector } from '../src/connectors/adapters/crisp.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_crisp_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'crisp',
    label: 'crisp test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { websiteId: 'web_1' },
    credentials: { kind: 'api-key', apiKey: 'crisp_token' },
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

describe('crisp messages.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/website/{websiteId}/conversation/{sessionId}/message with type=text', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    let requestHeaders: Record<string, string> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      requestHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      return jsonResponse({ fingerprint: 'fp_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await crispConnector.executeMutation!({
      source: source(),
      capabilityName: 'messages.send',
      args: {
        websiteId: 'web_1',
        sessionId: 'session_abc',
        content: 'hello world',
        from: 'operator',
        origin: 'chat',
      },
      idempotencyKey: 'k-msg-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/website/web_1/conversation/session_abc/message')
    expect(requestHeaders.authorization).toBe('Bearer crisp_token')
    expect(requestBody).toEqual({
      type: 'text',
      content: 'hello world',
      from: 'operator',
      origin: 'chat',
    })
  })
})

describe('crisp conversation.assign', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/website/{websiteId}/conversation/{sessionId}/routing with the assigned operator', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ error: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await crispConnector.executeMutation!({
      source: source(),
      capabilityName: 'conversation.assign',
      args: {
        websiteId: 'web_1',
        sessionId: 'session_abc',
        assigned: { user_id: 'op_drew' },
      },
      idempotencyKey: 'k-assign-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/website/web_1/conversation/session_abc/routing')
    expect(requestBody).toEqual({ assigned: { user_id: 'op_drew' } })
  })
})
