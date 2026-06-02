import { afterEach, describe, expect, it, vi } from 'vitest'
import { influencersClubConnector } from '../src/connectors/adapters/influencers-club.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_influencers_club_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'influencers-club',
    label: 'influencers-club test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'ic_secret' },
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

describe('influencers-club adapter manifest', () => {
  it('classifies itself as the crm category and exposes the influencers-club kind', () => {
    expect(influencersClubConnector.manifest.kind).toBe('influencers-club')
    expect(influencersClubConnector.manifest.category).toBe('crm')
    expect(influencersClubConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = influencersClubConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set plus the new list-management mutations', () => {
    const names = influencersClubConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'creators.enrich_by_email',
        'creators.enrich_by_handle',
        'creators.find_similar',
        'lists.add',
        'lists.create',
        'lists.delete',
      ].sort(),
    )
    const reads = influencersClubConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = influencersClubConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['creators.find_similar'])
    expect(mutations).toEqual(
      [
        'creators.enrich_by_email',
        'creators.enrich_by_handle',
        'lists.add',
        'lists.create',
        'lists.delete',
      ].sort(),
    )
  })

  it('marks the new list mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['lists.create', 'lists.add', 'lists.delete']
    for (const name of expected) {
      const cap = influencersClubConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('influencers-club lists.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/lists with the list payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'list_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await influencersClubConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.create',
      args: { name: 'Top creators', description: 'Q3 short-list' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.influencers.club/v1/lists')
    expect(requestBody).toMatchObject({ name: 'Top creators', description: 'Q3 short-list' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      influencersClubConnector.executeMutation!({
        source: source(),
        capabilityName: 'lists.create',
        args: { name: 'broken', description: 'irrelevant' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('influencers-club lists.add', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the creator id under /v1/lists/{list_id}/creators', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ added: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await influencersClubConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.add',
      args: { list_id: 'list_42', creator_id: 'creator_7' },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://api.influencers.club/v1/lists/list_42/creators')
    expect(requestBody).toMatchObject({ creator_id: 'creator_7' })
  })
})

describe('influencers-club lists.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/lists/{list_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await influencersClubConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.delete',
      args: { list_id: 'list_99' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.influencers.club/v1/lists/list_99')
  })
})
