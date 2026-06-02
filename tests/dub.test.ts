import { afterEach, describe, expect, it, vi } from 'vitest'
import { dubConnector } from '../src/connectors/adapters/dub.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_dub_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'dub',
    label: 'Dub test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'dub_secret' },
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

describe('dub adapter manifest', () => {
  it('exposes the dub kind and an explicit category', () => {
    expect(dubConnector.manifest.kind).toBe('dub')
    expect(dubConnector.manifest.category).toBe('other')
    expect(dubConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = dubConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the link CRUD action set plus tag creation', () => {
    const names = dubConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'links.create',
        'links.get',
        'links.list',
        'links.update',
        'links.delete',
        'tags.create',
      ].sort(),
    )
    const reads = dubConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = dubConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['links.get', 'links.list'].sort())
    expect(mutations).toEqual(
      ['links.create', 'links.delete', 'links.update', 'tags.create'].sort(),
    )
  })

  it('marks tags.create as native-idempotency externalEffect', () => {
    const cap = dubConnector.manifest.capabilities.find((c) => c.name === 'tags.create')
    if (!cap || cap.class !== 'mutation') throw new Error('tags.create must be a mutation')
    expect(cap.cas).toBe('native-idempotency')
    expect(cap.externalEffect).toBe(true)
  })
})

describe('dub tags.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /tags with name and color in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'tag_1', name: 'marketing', color: 'blue' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await dubConnector.executeMutation!({
      source: source(),
      capabilityName: 'tags.create',
      args: { name: 'marketing', color: 'blue' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.dub.co/tags')
    expect(requestBody).toEqual({ name: 'marketing', color: 'blue' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      dubConnector.executeMutation!({
        source: source(),
        capabilityName: 'tags.create',
        args: { name: 'marketing', color: 'blue' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
