import { afterEach, describe, expect, it, vi } from 'vitest'
import { ghostcmsConnector } from '../src/connectors/adapters/ghostcms.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_ghostcms_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'ghostcms',
    label: 'Ghost CMS test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl: 'https://blog.example.com' },
    credentials: { kind: 'api-key', apiKey: '5f::secret' },
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

describe('ghostcms posts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs the resolved publication URL + /ghost/api/admin/posts/{postId}/', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ghostcmsConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.delete',
      args: { postId: 'p_123' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe(
      'https://blog.example.com/ghost/api/admin/posts/p_123/',
    )
    expect(result.status).toBe('committed')
  })
})

describe('ghostcms members.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /ghost/api/admin/members/{memberId}/', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await ghostcmsConnector.executeMutation!({
      source: source(),
      capabilityName: 'members.delete',
      args: { memberId: 'mem_77' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe(
      'https://blog.example.com/ghost/api/admin/members/mem_77/',
    )
  })
})
