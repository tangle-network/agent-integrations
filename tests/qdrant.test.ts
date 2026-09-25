import { afterEach, describe, expect, it, vi } from 'vitest'
import { qdrantConnector } from '../src/connectors/adapters/qdrant.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_qdrant_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'qdrant',
    label: 'Qdrant test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: { qdrantUrl: 'https://example.qdrant.io:6333' },
    credentials: { kind: 'api-key', apiKey: 'qdrant_secret' },
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

describe('qdrant adapter manifest', () => {
  it('marks snapshot creation as cas="none" (server-side timestamped, non-idempotent)', () => {
    const byName = new Map(qdrantConnector.manifest.capabilities.map((c) => [c.name, c]))
    const snapshotCreate = byName.get('snapshots.create')
    const collectionsCreate = byName.get('collections.create')
    const pointsUpsert = byName.get('points.upsert')
    if (
      !snapshotCreate ||
      snapshotCreate.class !== 'mutation' ||
      !collectionsCreate ||
      collectionsCreate.class !== 'mutation' ||
      !pointsUpsert ||
      pointsUpsert.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(snapshotCreate.cas).toBe('none')
    // Collection PUT and point upsert with caller-supplied ids are idempotent.
    expect(collectionsCreate.cas).toBe('native-idempotency')
    expect(pointsUpsert.cas).toBe('native-idempotency')
  })
})

describe('qdrant write capabilities', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('snapshots.restore PUTs /collections/{name}/snapshots/recover with the location body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string | undefined
      return jsonResponse({ result: true, status: 'ok' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await qdrantConnector.executeMutation!({
      source: source(),
      capabilityName: 'snapshots.restore',
      args: {
        collection_name: 'docs',
        location: 'https://snapshots.example.com/docs-2026-06-02.snapshot',
        priority: 'snapshot',
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/collections/docs/snapshots/recover')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed.location).toBe('https://snapshots.example.com/docs-2026-06-02.snapshot')
    expect(parsed.priority).toBe('snapshot')
  })

  it('shards.create PUTs /collections/{name}/shards with the shard_key body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string | undefined
      return jsonResponse({ result: true, status: 'ok' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await qdrantConnector.executeMutation!({
      source: source(),
      capabilityName: 'shards.create',
      args: { collection_name: 'docs', shard_key: 'tenant_42', shards_number: 2 },
      idempotencyKey: 'k-2',
    })

    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/collections/docs/shards')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed.shard_key).toBe('tenant_42')
    expect(parsed.shards_number).toBe(2)
  })

  it('shards.delete POSTs /collections/{name}/shards/delete with the shard_key body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string | undefined
      return jsonResponse({ result: true, status: 'ok' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await qdrantConnector.executeMutation!({
      source: source(),
      capabilityName: 'shards.delete',
      args: { collection_name: 'docs', shard_key: 'tenant_42' },
      idempotencyKey: 'k-3',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/collections/docs/shards/delete')
    const parsed = JSON.parse(String(requestBody)) as Record<string, unknown>
    expect(parsed.shard_key).toBe('tenant_42')
  })

  it('cluster.peer.remove DELETEs /cluster/peer/{peer_id} and forwards force as a query param', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ result: true, status: 'ok' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await qdrantConnector.executeMutation!({
      source: source(),
      capabilityName: 'cluster.peer.remove',
      args: { peer_id: 9876, force: true },
      idempotencyKey: 'k-4',
    })

    expect(requestMethod).toBe('DELETE')
    const url = new URL(String(requestUrl))
    expect(url.pathname).toContain('/cluster/peer/9876')
    expect(url.searchParams.get('force')).toBe('true')
  })
})
