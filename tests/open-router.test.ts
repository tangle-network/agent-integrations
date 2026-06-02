import { afterEach, describe, expect, it, vi } from 'vitest'
import { openRouterConnector } from '../src/connectors/adapters/open-router.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_open-router_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'open-router',
    label: 'open-router test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'or_secret' },
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

describe('open-router adapter manifest', () => {
  it('classifies itself as the other category and exposes the open-router kind', () => {
    expect(openRouterConnector.manifest.kind).toBe('open-router')
    expect(openRouterConnector.manifest.category).toBe('other')
    expect(openRouterConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = openRouterConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('extends the action set with credits.get + keys.list/create/revoke', () => {
    const names = openRouterConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'completions.create',
        'credits.get',
        'keys.create',
        'keys.list',
        'keys.revoke',
        'models.list',
      ].sort(),
    )
    const reads = openRouterConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = openRouterConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['credits.get', 'keys.list', 'models.list'].sort())
    expect(mutations).toEqual(['completions.create', 'keys.create', 'keys.revoke'].sort())
  })

  it('marks keys.create and keys.revoke as native-idempotency externalEffect', () => {
    for (const name of ['keys.create', 'keys.revoke']) {
      const cap = openRouterConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      expect(cap!.class).toBe('mutation')
      if (cap!.class !== 'mutation') throw new Error('unreachable')
      expect(cap!.cas).toBe('native-idempotency')
      expect(cap!.externalEffect).toBe(true)
    }
  })
})

describe('open-router wire behavior', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('credits.get issues GET /credits with bearer auth', async () => {
    let capturedUrl: string | undefined
    let capturedAuth: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedAuth = ((init?.headers ?? {}) as Record<string, string>).authorization
        return jsonResponse({ data: { total_credits: 12.5, total_usage: 4.3 } })
      }),
    )
    const result = await openRouterConnector.executeRead!({
      source: source(),
      capabilityName: 'credits.get',
      args: {},
      idempotencyKey: 'k',
    })
    expect(capturedUrl).toContain('/api/v1/credits')
    expect(capturedAuth).toBe('Bearer or_secret')
    const data = result.data as { data: { total_credits: number } }
    expect(data.data.total_credits).toBe(12.5)
  })

  it('keys.list issues GET /keys', async () => {
    let capturedUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input)
        return jsonResponse({ data: [{ hash: 'h1', name: 'k' }] })
      }),
    )
    await openRouterConnector.executeRead!({
      source: source(),
      capabilityName: 'keys.list',
      args: {},
      idempotencyKey: 'k',
    })
    expect(capturedUrl).toContain('/api/v1/keys')
  })

  it('keys.create POSTs /keys with the requested name', async () => {
    let capturedMethod: string | undefined
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedMethod = init?.method
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonResponse({ data: { hash: 'h_new', name: 'prod' } }, { status: 201 })
      }),
    )
    const result = await openRouterConnector.executeMutation!({
      source: source(),
      capabilityName: 'keys.create',
      args: { name: 'prod' },
      idempotencyKey: 'k-create',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedBody.name).toBe('prod')
    expect(result.status).toBe('committed')
  })

  it('keys.revoke issues DELETE /keys/{hash} and treats 204 as committed', async () => {
    let capturedMethod: string | undefined
    let capturedUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedMethod = init?.method
        capturedUrl = String(input)
        return new Response(null, { status: 204 })
      }),
    )
    const result = await openRouterConnector.executeMutation!({
      source: source(),
      capabilityName: 'keys.revoke',
      args: { hash: 'h_old' },
      idempotencyKey: 'k-rev',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toContain('/api/v1/keys/h_old')
    expect(result.status).toBe('committed')
  })

  it('keys.create surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      openRouterConnector.executeMutation!({
        source: source(),
        capabilityName: 'keys.create',
        args: { name: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
