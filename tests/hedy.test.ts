import { afterEach, describe, expect, it, vi } from 'vitest'
import { hedyConnector } from '../src/connectors/adapters/hedy.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_hedy_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'hedy',
    label: 'hedy test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'hedy_secret' },
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

describe('hedy topics.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/topics/{topicId} and returns committed', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await hedyConnector.executeMutation!({
      source: source(),
      capabilityName: 'topics.delete',
      args: { topicId: 'top_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.hedy.ai/v1/topics/top_42')
    expect(result.status).toBe('committed')
  })
})

describe('hedy context.update and context.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/context/{contextId} with body args', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string
      return jsonResponse({ id: 'ctx_1', title: 'Updated' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await hedyConnector.executeMutation!({
      source: source(),
      capabilityName: 'context.update',
      args: { contextId: 'ctx_1', title: 'Updated', content: 'new body' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toBe('https://api.hedy.ai/v1/context/ctx_1')
    expect(JSON.parse(requestBody ?? '{}')).toMatchObject({
      contextId: 'ctx_1',
      title: 'Updated',
      content: 'new body',
    })
    expect(result.status).toBe('committed')
  })

  it('DELETEs /v1/context/{contextId}', async () => {
    let requestMethod: string | undefined
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestMethod = init?.method
        requestUrl = String(input)
        return jsonResponse({ deleted: true })
      }),
    )

    const result = await hedyConnector.executeMutation!({
      source: source(),
      capabilityName: 'context.delete',
      args: { contextId: 'ctx_99' },
      idempotencyKey: 'k-2',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.hedy.ai/v1/context/ctx_99')
    expect(result.status).toBe('committed')
  })
})
