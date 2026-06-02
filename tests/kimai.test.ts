import { afterEach, describe, expect, it, vi } from 'vitest'
import { kimaiConnector, type ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_kimai_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'kimai',
    label: 'Drew Kimai',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { instanceUrl: 'https://kimai.example.com', kimaiUser: 'drew' },
    credentials: {
      kind: 'api-key',
      apiKey: 'token_123',
    },
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

describe('kimai adapter manifest', () => {
  it('exposes the kimai kind and a stable consistency model for timesheet writes', () => {
    expect(kimaiConnector.manifest.kind).toBe('kimai')
    expect(kimaiConnector.manifest.category).toBe('other')
    expect(kimaiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = kimaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus stop/list/projects.list', () => {
    const names = kimaiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'projects.list',
      'timesheets.create',
      'timesheets.list',
      'timesheets.stop',
    ])
    const mutations = kimaiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['timesheets.create', 'timesheets.stop'])
  })

  it('marks every mutation with native-idempotency + externalEffect', () => {
    const mutations = kimaiConnector.manifest.capabilities.filter(
      (c) => c.class === 'mutation',
    )
    for (const m of mutations) {
      expect(m).toMatchObject({ cas: 'native-idempotency', externalEffect: true })
    }
  })
})

describe('kimai adapter execution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('timesheets.stop PATCHes /api/timesheets/{id}/stop and returns committed', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init: init ?? {} }
      return jsonResponse({ id: 42, end: '2026-06-02T15:30:00+00:00' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kimaiConnector.executeMutation!({
      source: source(),
      capabilityName: 'timesheets.stop',
      args: { id: 42 },
      idempotencyKey: 'idemp-stop-1',
    })

    expect(result.status).toBe('committed')
    expect(captured!.url).toBe('https://kimai.example.com/api/timesheets/42/stop')
    expect(captured!.init.method).toBe('PATCH')
    if (result.status === 'committed') {
      expect((result.data as { id: number }).id).toBe(42)
      expect(result.idempotentReplay).toBe(false)
      expect(typeof result.committedAt).toBe('number')
    }
  })

  it('timesheets.stop rejects when id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      kimaiConnector.executeMutation!({
        source: source(),
        capabilityName: 'timesheets.stop',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: id/)
  })

  it('timesheets.stop surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('unauthorized', {
            status: 401,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      kimaiConnector.executeMutation!({
        source: source(),
        capabilityName: 'timesheets.stop',
        args: { id: 7 },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('timesheets.list GETs /api/timesheets with optional filters as query params', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method
      return jsonResponse([{ id: 1 }, { id: 2 }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kimaiConnector.executeRead!({
      source: source(),
      capabilityName: 'timesheets.list',
      args: { user: 'all', project: 5, page: 2, size: 50 },
      idempotencyKey: 'k',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toContain('/api/timesheets?')
    expect(capturedUrl).toContain('user=all')
    expect(capturedUrl).toContain('project=5')
    expect(capturedUrl).toContain('page=2')
    expect(capturedUrl).toContain('size=50')
    expect(capturedUrl).not.toContain('activity=')
    expect(Array.isArray(result.data)).toBe(true)
    expect(typeof result.fetchedAt).toBe('number')
  })

  it('timesheets.list omits unset filters from the query string', async () => {
    let capturedUrl: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input)
        return jsonResponse([])
      }),
    )
    await kimaiConnector.executeRead!({
      source: source(),
      capabilityName: 'timesheets.list',
      args: {},
      idempotencyKey: 'k',
    })
    expect(capturedUrl).toBe('https://kimai.example.com/api/timesheets')
  })

  it('timesheets.list surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('forbidden', {
            status: 403,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      kimaiConnector.executeRead!({
        source: source(),
        capabilityName: 'timesheets.list',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('projects.list GETs /api/projects with optional visible/customer filters', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method
        return jsonResponse([{ id: 1, name: 'Internal' }])
      }),
    )

    const result = await kimaiConnector.executeRead!({
      source: source(),
      capabilityName: 'projects.list',
      args: { visible: 1, customer: 9 },
      idempotencyKey: 'k',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toContain('/api/projects?')
    expect(capturedUrl).toContain('visible=1')
    expect(capturedUrl).toContain('customer=9')
    const data = result.data as Array<{ id: number; name: string }>
    expect(data[0]).toMatchObject({ id: 1, name: 'Internal' })
  })

  it('projects.list omits unset filters from the query string', async () => {
    let capturedUrl: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input)
        return jsonResponse([])
      }),
    )
    await kimaiConnector.executeRead!({
      source: source(),
      capabilityName: 'projects.list',
      args: {},
      idempotencyKey: 'k',
    })
    expect(capturedUrl).toBe('https://kimai.example.com/api/projects')
  })

  it('projects.list surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('unauthorized', {
            status: 401,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      kimaiConnector.executeRead!({
        source: source(),
        capabilityName: 'projects.list',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
