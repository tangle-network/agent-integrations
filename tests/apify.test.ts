import { afterEach, describe, expect, it, vi } from 'vitest'
import { apifyConnector } from '../src/connectors/adapters/apify.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_apify_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'apify',
    label: 'apify test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'apify_secret' },
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

describe('apify adapter manifest', () => {
  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = apifyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Apify/i)
  })

})

describe('apify actor.abort', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/actor-runs/{runId}/abort with optional gracefully flag', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ data: { id: 'run_1', status: 'ABORTING' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apifyConnector.executeMutation!({
      source: source(),
      capabilityName: 'actor.abort',
      args: { runId: 'run_1', gracefully: true },
      idempotencyKey: 'k-abort',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.apify.com/v2/actor-runs/run_1/abort?gracefully=true')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      apifyConnector.executeMutation!({
        source: source(),
        capabilityName: 'actor.abort',
        args: { runId: 'run_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('apify dataset.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v2/datasets/{datasetId}', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apifyConnector.executeMutation!({
      source: source(),
      capabilityName: 'dataset.delete',
      args: { datasetId: 'ds_1' },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.apify.com/v2/datasets/ds_1')
    expect(result.status).toBe('committed')
  })
})

describe('apify dataset.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/datasets with the name as a query param', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ data: { id: 'ds_new', name: 'leads' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await apifyConnector.executeMutation!({
      source: source(),
      capabilityName: 'dataset.create',
      args: { name: 'leads' },
      idempotencyKey: 'k-create',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.apify.com/v2/datasets?name=leads')
    expect(result.status).toBe('committed')
  })
})
