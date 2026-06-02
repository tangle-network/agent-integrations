import { afterEach, describe, expect, it, vi } from 'vitest'
import { folkConnector } from '../src/connectors/adapters/folk.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_folk_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'folk',
    label: 'Folk test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'folk_secret' },
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

describe('folk adapter manifest', () => {
  it('classifies itself as the crm category and exposes the folk kind', () => {
    expect(folkConnector.manifest.kind).toBe('folk')
    expect(folkConnector.manifest.category).toBe('crm')
    expect(folkConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = folkConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set plus delete.person', () => {
    const names = folkConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'create.company',
        'update.company',
        'create.person',
        'update.person',
        'delete.person',
        'find.company',
        'get.company',
        'find.person',
        'get.person',
      ].sort(),
    )
    const reads = folkConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = folkConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['find.company', 'find.person', 'get.company', 'get.person'].sort(),
    )
    expect(mutations).toEqual(
      ['create.company', 'create.person', 'delete.person', 'update.company', 'update.person'].sort(),
    )
  })

  it('marks delete.person as native-idempotency external effect', () => {
    const cap = folkConnector.manifest.capabilities.find((c) => c.name === 'delete.person')
    expect(cap).toBeDefined()
    if (!cap || cap.class !== 'mutation') throw new Error('unreachable')
    expect(cap.cas).toBe('native-idempotency')
    expect(cap.externalEffect).toBe(true)
  })
})

describe('folk delete.person', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/people/{personId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'p_1', deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await folkConnector.executeMutation!({
      source: source(),
      capabilityName: 'delete.person',
      args: { personId: 'p_1' },
      idempotencyKey: 'k-del-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/people/p_1')
    expect(result.status).toBe('committed')
  })

  it('rejects when required personId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      folkConnector.executeMutation!({
        source: source(),
        capabilityName: 'delete.person',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: personId/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      folkConnector.executeMutation!({
        source: source(),
        capabilityName: 'delete.person',
        args: { personId: 'p_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
