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
