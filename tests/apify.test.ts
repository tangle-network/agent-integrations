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
  it('classifies itself as the database category and exposes the apify kind', () => {
    expect(apifyConnector.manifest.kind).toBe('apify')
    expect(apifyConnector.manifest.category).toBe('database')
    expect(apifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = apifyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Apify/i)
  })

  it('covers datasets, key-value stores, actors, tasks, web scraping, and run/dataset lifecycle', () => {
    const names = apifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'actor.abort',
        'actor.run.resurrect',
        'actors.run',
        'dataset.create',
        'dataset.delete',
        'datasets.items.get',
        'keyvalue-stores.records.get',
        'tasks.run',
        'web-scrape.url',
      ].sort(),
    )
    const mutations = apifyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'actor.abort',
        'actor.run.resurrect',
        'actors.run',
        'dataset.create',
        'dataset.delete',
        'tasks.run',
        'web-scrape.url',
      ].sort(),
    )
  })

  it('marks the new lifecycle mutations as native-idempotency external-effect', () => {
    for (const name of ['actor.abort', 'actor.run.resurrect', 'dataset.create', 'dataset.delete']) {
      const cap = apifyConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
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
