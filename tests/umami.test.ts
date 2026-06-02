import { afterEach, describe, expect, it, vi } from 'vitest'
import { umamiConnector } from '../src/connectors/adapters/umami.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const UMAMI_BASE = 'https://umami.example.com'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_umami_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'umami',
    label: 'umami test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl: UMAMI_BASE },
    credentials: { kind: 'api-key', apiKey: 'umami_secret' },
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

describe('umami adapter manifest', () => {
  it('classifies itself as the database category and exposes the umami kind', () => {
    expect(umamiConnector.manifest.kind).toBe('umami')
    expect(umamiConnector.manifest.category).toBe('database')
    expect(umamiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = umamiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Umami/i)
  })

  it('covers read and mutation capability surfaces including websites CRUD + teams.list', () => {
    const names = umamiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'event.send',
        'teams.list',
        'website.active_visitors',
        'website.metrics',
        'website.pageviews',
        'website.stats',
        'websites.create',
        'websites.delete',
        'websites.list',
        'websites.update',
      ].sort(),
    )
    const mutations = umamiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['event.send', 'websites.create', 'websites.delete', 'websites.update'].sort(),
    )
  })

  it('marks every mutation as native-idempotency external-effect', () => {
    const caps = umamiConnector.manifest.capabilities
    for (const c of caps) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('umami websites.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to {baseUrl}/api/websites with the create payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'w_1', name: 'Site', domain: 'example.com' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await umamiConnector.executeMutation!({
      source: source(),
      capabilityName: 'websites.create',
      args: { name: 'Site', domain: 'example.com' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe(`${UMAMI_BASE}/api/websites`)
    expect(requestBody).toMatchObject({ name: 'Site', domain: 'example.com' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      umamiConnector.executeMutation!({
        source: source(),
        capabilityName: 'websites.create',
        args: { name: 'Site', domain: 'example.com' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('umami websites.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/websites/{websiteId} with the patch body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'w_1', name: 'New name' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await umamiConnector.executeMutation!({
      source: source(),
      capabilityName: 'websites.update',
      args: { websiteId: 'w_1', name: 'New name' },
      idempotencyKey: 'k-2',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe(`${UMAMI_BASE}/api/websites/w_1`)
    expect(requestBody).toMatchObject({ websiteId: 'w_1', name: 'New name' })
  })
})

describe('umami websites.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/websites/{websiteId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await umamiConnector.executeMutation!({
      source: source(),
      capabilityName: 'websites.delete',
      args: { websiteId: 'w_1' },
      idempotencyKey: 'k-3',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe(`${UMAMI_BASE}/api/websites/w_1`)
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      umamiConnector.executeMutation!({
        source: source(),
        capabilityName: 'websites.delete',
        args: { websiteId: 'w_1' },
        idempotencyKey: 'k-3',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('umami teams.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/teams', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse([{ id: 't_1', name: 'Team A' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await umamiConnector.executeRead!({
      source: source(),
      capabilityName: 'teams.list',
      args: {},
      idempotencyKey: 'k-4',
    })

    expect(requestMethod).toBe('GET')
    expect(requestUrl).toBe(`${UMAMI_BASE}/api/teams`)
    expect(Array.isArray(result.data)).toBe(true)
  })
})
