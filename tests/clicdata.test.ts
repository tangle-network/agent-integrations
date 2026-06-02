import { afterEach, describe, expect, it, vi } from 'vitest'
import { clicdataConnector } from '../src/connectors/adapters/clicdata.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_clicdata_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'clicdata',
    label: 'ClicData test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'clicdata_token' },
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

describe('clicdata adapter manifest', () => {
  it('classifies itself as the database category and exposes the clicdata kind', () => {
    expect(clicdataConnector.manifest.kind).toBe('clicdata')
    expect(clicdataConnector.manifest.category).toBe('database')
    expect(clicdataConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = clicdataConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('exposes read + mutation capabilities including new dataset/dashboard writes', () => {
    const names = clicdataConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'account.get',
        'dashboards.get',
        'dashboards.list',
        'dashboards.refresh',
        'datasets.clear',
        'datasets.create',
        'datasets.delete',
        'datasets.get',
        'datasets.list',
        'datasets.refresh',
        'datasets.rows',
        'datasets.rows.append',
        'datasets.rows.replace',
      ].sort(),
    )
    const reads = clicdataConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = clicdataConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'account.get',
        'dashboards.get',
        'dashboards.list',
        'datasets.get',
        'datasets.list',
        'datasets.rows',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'dashboards.refresh',
        'datasets.clear',
        'datasets.create',
        'datasets.delete',
        'datasets.refresh',
        'datasets.rows.append',
        'datasets.rows.replace',
      ].sort(),
    )
  })

  it('marks new mutations (datasets.create, datasets.delete, dashboards.refresh) as native-idempotency external effect', () => {
    const targets = ['datasets.create', 'datasets.delete', 'dashboards.refresh']
    for (const name of targets) {
      const cap = clicdataConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('clicdata datasets.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /datasets with name + columns', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'ds_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await clicdataConnector.executeMutation!({
      source: source(),
      capabilityName: 'datasets.create',
      args: {
        name: 'Leads',
        description: 'inbound leads',
        columns: [{ name: 'email', type: 'string' }],
      },
      idempotencyKey: 'create-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.clicdata.com/datasets')
    expect(capturedBody).toMatchObject({
      name: 'Leads',
      description: 'inbound leads',
      columns: [{ name: 'email', type: 'string' }],
    })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      clicdataConnector.executeMutation!({
        source: source(),
        capabilityName: 'datasets.create',
        args: { name: 'X', columns: [] },
        idempotencyKey: 'create-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('clicdata datasets.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /datasets/{datasetId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await clicdataConnector.executeMutation!({
      source: source(),
      capabilityName: 'datasets.delete',
      args: { datasetId: 'ds_1' },
      idempotencyKey: 'del-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.clicdata.com/datasets/ds_1')
    expect(result.status).toBe('committed')
  })
})

describe('clicdata dashboards.refresh', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /dashboards/{dashboardId}/refresh', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ refreshed: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await clicdataConnector.executeMutation!({
      source: source(),
      capabilityName: 'dashboards.refresh',
      args: { dashboardId: 'dash_1' },
      idempotencyKey: 'refresh-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.clicdata.com/dashboards/dash_1/refresh')
    expect(result.status).toBe('committed')
  })
})
