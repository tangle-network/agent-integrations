import { afterEach, describe, expect, it, vi } from 'vitest'
import { googlechatConnector } from '../src/connectors/adapters/googlechat.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_gchat_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'googlechat',
    label: 'gchat test',
    consistencyModel: 'authoritative',
    scopes: ['https://www.googleapis.com/auth/chat.messages', 'https://www.googleapis.com/auth/chat.spaces'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'ya29_abc' },
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

describe('googlechat space.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the Space resource to /v1/spaces', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ name: 'spaces/AAA1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await googlechatConnector.executeMutation!({
      source: source(),
      capabilityName: 'space.create',
      args: { space: { displayName: 'Engineering', spaceType: 'SPACE' } },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://chat.googleapis.com/v1/spaces')
    expect(requestBody).toMatchObject({ displayName: 'Engineering', spaceType: 'SPACE' })
    expect(result.status).toBe('committed')
  })
})

describe('googlechat message.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/{name}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await googlechatConnector.executeMutation!({
      source: source(),
      capabilityName: 'message.delete',
      args: { name: 'spaces/AAA/messages/BBB' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    // declarative-rest URL-encodes path segment substitutions, so the resource
    // name's '/' characters land as %2F in the final URL.
    expect(String(requestUrl)).toBe(
      'https://chat.googleapis.com/v1/spaces%2FAAA%2Fmessages%2FBBB',
    )
  })
})
