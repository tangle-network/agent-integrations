import { afterEach, describe, expect, it, vi } from 'vitest'
import { segmentConnector } from '../src/connectors/adapters/segment.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'
import { validateConnectorManifest } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_segment_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'segment',
    label: 'segment test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'segment_secret' },
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

describe('segment adapter manifest', () => {
  it('ships a valid manifest', () => {
    const result = validateConnectorManifest(segmentConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('exposes the segment kind, database category, and authoritative consistency', () => {
    expect(segmentConnector.manifest.kind).toBe('segment')
    expect(segmentConnector.manifest.displayName).toBe('Segment')
    expect(segmentConnector.manifest.category).toBe('database')
    expect(segmentConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (Segment Public API is a workspace-issued personal access token)', () => {
    const auth = segmentConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/personal access token/i)
    expect(auth.hint).toMatch(/segment/i)
  })

  it('covers the Public API surface: sources, destinations, tracking-plans, audiences, warehouses', () => {
    const names = segmentConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'sources.search',
        'sources.get',
        'sources.create',
        'sources.update',
        'sources.delete',
        'destinations.search',
        'destinations.get',
        'destinations.create',
        'destinations.update',
        'destinations.delete',
        'tracking-plans.search',
        'tracking-plans.get',
        'tracking-plans.create',
        'tracking-plans.update',
        'tracking-plans.delete',
        'tracking-plans.connect',
        'audiences.search',
        'audiences.get',
        'audiences.create',
        'audiences.update',
        'audiences.delete',
        'warehouses.create',
      ].sort(),
    )
    const reads = segmentConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = segmentConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'audiences.get',
        'audiences.search',
        'destinations.get',
        'destinations.search',
        'sources.get',
        'sources.search',
        'tracking-plans.get',
        'tracking-plans.search',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'audiences.create',
        'audiences.delete',
        'audiences.update',
        'destinations.create',
        'destinations.delete',
        'destinations.update',
        'sources.create',
        'sources.delete',
        'sources.update',
        'tracking-plans.connect',
        'tracking-plans.create',
        'tracking-plans.delete',
        'tracking-plans.update',
        'warehouses.create',
      ].sort(),
    )
  })

  it('marks every mutation native-idempotency + externalEffect=true', () => {
    const mutations = segmentConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const mutation of mutations) {
      if (mutation.class !== 'mutation') throw new Error('unreachable')
      expect(mutation.cas).toBe('native-idempotency')
      expect(mutation.externalEffect).toBe(true)
    }
  })

  it('marks new write-side mutations as native-idempotency + externalEffect=true', () => {
    for (const name of ['tracking-plans.connect', 'audiences.update', 'audiences.delete', 'warehouses.create']) {
      const cap = segmentConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof segmentConnector.executeRead).toBe('function')
    expect(typeof segmentConnector.executeMutation).toBe('function')
  })
})

describe('segment tracking-plans.connect', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /tracking-plans/{trackingPlanId}/sources with sourceId body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ status: 'connected' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await segmentConnector.executeMutation!({
      source: source(),
      capabilityName: 'tracking-plans.connect',
      args: { trackingPlanId: 'tp_123', sourceId: 'src_456' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.segmentapis.com/tracking-plans/tp_123/sources')
    expect(requestBody).toEqual({ sourceId: 'src_456' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      segmentConnector.executeMutation!({
        source: source(),
        capabilityName: 'tracking-plans.connect',
        args: { trackingPlanId: 'tp_1', sourceId: 'src_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('segment audiences.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /spaces/{spaceId}/audiences/{audienceId} with the supplied fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'aud_1', name: 'Renamed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await segmentConnector.executeMutation!({
      source: source(),
      capabilityName: 'audiences.update',
      args: { spaceId: 'spc_1', audienceId: 'aud_1', name: 'Renamed' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.segmentapis.com/spaces/spc_1/audiences/aud_1')
    expect(requestBody).toMatchObject({ name: 'Renamed' })
  })
})

describe('segment audiences.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /spaces/{spaceId}/audiences/{audienceId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await segmentConnector.executeMutation!({
      source: source(),
      capabilityName: 'audiences.delete',
      args: { spaceId: 'spc_1', audienceId: 'aud_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.segmentapis.com/spaces/spc_1/audiences/aud_42')
    expect(result.status).toBe('committed')
  })
})

describe('segment warehouses.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /warehouses with the warehouse body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'wh_new' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await segmentConnector.executeMutation!({
      source: source(),
      capabilityName: 'warehouses.create',
      args: {
        metadataId: 'wh_metadata_snowflake',
        name: 'Analytics WH',
        enabled: true,
        settings: { account: 'acct', region: 'us-east-1' },
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.segmentapis.com/warehouses')
    expect(requestBody).toMatchObject({
      metadataId: 'wh_metadata_snowflake',
      name: 'Analytics WH',
      enabled: true,
      settings: { account: 'acct', region: 'us-east-1' },
    })
  })
})
