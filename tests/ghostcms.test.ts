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

describe('ghostcms adapter manifest', () => {
  it('classifies itself as the crm category and exposes the ghostcms kind', () => {
    expect(ghostcmsConnector.manifest.kind).toBe('ghostcms')
    expect(ghostcmsConnector.manifest.category).toBe('crm')
    expect(ghostcmsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = ghostcmsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the ghost admin action set incl. post & member lifecycle writes', () => {
    const names = ghostcmsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'members.create',
        'members.update',
        'members.delete',
        'members.find',
        'posts.create',
        'posts.update',
        'posts.delete',
        'users.find',
      ].sort(),
    )
    const reads = ghostcmsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = ghostcmsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['members.find', 'users.find'].sort())
    expect(mutations).toEqual(
      [
        'members.create',
        'members.update',
        'members.delete',
        'posts.create',
        'posts.update',
        'posts.delete',
      ].sort(),
    )
  })

  it('marks new lifecycle mutations as native-idempotent external effect', () => {
    const newMutations = ['posts.update', 'posts.delete', 'members.delete']
    for (const name of newMutations) {
      const cap = ghostcmsConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} should be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      ghostcmsConnector.executeMutation!({
        source: source(),
        capabilityName: 'posts.delete',
        args: { postId: 'p_123' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
