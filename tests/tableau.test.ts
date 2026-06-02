import { afterEach, describe, expect, it, vi } from 'vitest'
import { tableauConnector } from '../src/connectors/adapters/tableau.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_tableau_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'tableau',
    label: 'tableau test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { serverUrl: 'https://tableau.example.com' },
    credentials: { kind: 'api-key', apiKey: 'tableau_secret' },
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

describe('tableau adapter manifest', () => {
  it('classifies itself as the database category and exposes the tableau kind', () => {
    expect(tableauConnector.manifest.kind).toBe('tableau')
    expect(tableauConnector.manifest.category).toBe('database')
    expect(tableauConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = tableauConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Tableau/i)
  })

  it('covers the views, workbooks, extracts, subscriptions, and datasources capability surface', () => {
    const names = tableauConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'datasources.query',
        'datasources.delete',
        'extracts.refresh',
        'subscriptions.create',
        'views.download',
        'views.find',
        'workbooks.delete',
        'workbooks.find',
        'workbooks.refresh',
      ].sort(),
    )
  })

  it('includes read and mutation operations with native-idempotency on every mutation', () => {
    const reads = tableauConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['datasources.query', 'views.download', 'views.find', 'workbooks.find'].sort())

    const mutations = tableauConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'datasources.delete',
        'extracts.refresh',
        'subscriptions.create',
        'workbooks.delete',
        'workbooks.refresh',
      ].sort(),
    )

    for (const cap of tableauConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('tableau workbooks.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/3.19/sites/{siteId}/workbooks/{workbookId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await tableauConnector.executeMutation!({
      source: source(),
      capabilityName: 'workbooks.delete',
      args: { siteId: 'site_a', workbookId: 'wb_1' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/3.19/sites/site_a/workbooks/wb_1')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      tableauConnector.executeMutation!({
        source: source(),
        capabilityName: 'workbooks.delete',
        args: { siteId: 'site_a', workbookId: 'wb_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('tableau subscriptions.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/3.19/sites/{siteId}/subscriptions with the subscription envelope', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ subscription: { id: 'sub_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await tableauConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.create',
      args: {
        siteId: 'site_a',
        subscription: { subject: 'Daily Sales', contentId: 'view_1', userId: 'u_1', scheduleId: 'sch_1' },
      },
      idempotencyKey: 'k-2',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/3.19/sites/site_a/subscriptions')
    expect(requestBody).toMatchObject({
      subscription: { subject: 'Daily Sales', contentId: 'view_1' },
    })
  })
})

describe('tableau datasources.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/3.19/sites/{siteId}/datasources/{datasourceId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await tableauConnector.executeMutation!({
      source: source(),
      capabilityName: 'datasources.delete',
      args: { siteId: 'site_a', datasourceId: 'ds_1' },
      idempotencyKey: 'k-3',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/3.19/sites/site_a/datasources/ds_1')
  })
})
