import { afterEach, describe, expect, it, vi } from 'vitest'
import { tlDvConnector } from '../src/connectors/adapters/tl-dv.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_tl-dv_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'tl-dv',
    label: 'tl-dv test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'tldv_secret' },
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

describe('tl-dv adapter manifest', () => {
  it('classifies itself as the docs category and exposes the tl-dv kind', () => {
    expect(tlDvConnector.manifest.kind).toBe('tl-dv')
    expect(tlDvConnector.manifest.category).toBe('doc')
    expect(tlDvConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = tlDvConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/tl;dv/i)
  })

  it('covers meetings, transcripts, highlights, share-links, and summaries capability surface', () => {
    const names = tlDvConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'meetings.list',
        'meetings.get',
        'meetings.upload',
        'meetings.delete',
        'transcripts.get',
        'highlights.get',
        'highlights.create',
        'share-links.create',
        'summaries.regenerate',
      ].sort(),
    )
    const mutations = tlDvConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'meetings.upload',
        'meetings.delete',
        'highlights.create',
        'share-links.create',
        'summaries.regenerate',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    const mutations = tlDvConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const cap of mutations) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('tl-dv meetings.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /meetings/{meetingId} and tolerates a 204 response', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: BodyInit | null | undefined
    let authHeader: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body
      const headers = init?.headers as Record<string, string> | undefined
      authHeader = headers?.authorization
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await tlDvConnector.executeMutation!({
      source: source(),
      capabilityName: 'meetings.delete',
      args: { meetingId: 'mtg_1' },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.tldv.io/v1/meetings/mtg_1')
    expect(requestBody).toBeUndefined()
    expect(authHeader).toBe('Bearer tldv_secret')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      tlDvConnector.executeMutation!({
        source: source(),
        capabilityName: 'meetings.delete',
        args: { meetingId: 'mtg_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('tl-dv highlights.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /meetings/{meetingId}/highlights with the args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'hi_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await tlDvConnector.executeMutation!({
      source: source(),
      capabilityName: 'highlights.create',
      args: {
        meetingId: 'mtg_42',
        startTime: 10,
        endTime: 25,
        title: 'Key insight',
      },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.tldv.io/v1/meetings/mtg_42/highlights')
    expect(requestBody).toMatchObject({ startTime: 10, endTime: 25, title: 'Key insight' })
    expect(result.status).toBe('committed')
  })
})

describe('tl-dv share-links.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /meetings/{meetingId}/share-links', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ url: 'https://tldv.io/share/abc' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await tlDvConnector.executeMutation!({
      source: source(),
      capabilityName: 'share-links.create',
      args: { meetingId: 'mtg_9' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.tldv.io/v1/meetings/mtg_9/share-links')
  })
})

describe('tl-dv summaries.regenerate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /meetings/{meetingId}/summary/regenerate', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'queued' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await tlDvConnector.executeMutation!({
      source: source(),
      capabilityName: 'summaries.regenerate',
      args: { meetingId: 'mtg_77' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.tldv.io/v1/meetings/mtg_77/summary/regenerate')
    expect(result.status).toBe('committed')
  })
})
