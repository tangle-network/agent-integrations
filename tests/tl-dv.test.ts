import { afterEach, describe, expect, it, vi } from 'vitest'
import { tlDvConnector } from '../src/connectors/adapters/tl-dv.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return {
    id: 'src_tl-dv_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'tl-dv',
    label: 'tl;dv test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'tldv_secret' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('tl;dv adapter manifest', () => {
  it('exposes exactly the five published tl;dv actions', () => {
    expect(tlDvConnector.manifest).toMatchObject({
      kind: 'tl-dv',
      category: 'doc',
      defaultConsistencyModel: 'authoritative',
      auth: { kind: 'api-key' },
    })
    expect(tlDvConnector.manifest.capabilities.map((capability) => capability.name).sort()).toEqual(
      ['highlights.get', 'meetings.get', 'meetings.list', 'meetings.upload', 'transcripts.get'],
    )
    expect(tlDvConnector.manifest.capabilities.find((capability) => capability.name === 'meetings.upload'))
      .toMatchObject({ class: 'mutation', cas: 'native-idempotency', externalEffect: true })
  })
})

describe('tl;dv execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists meetings from pasta.tldv.io/v1alpha1 with x-api-key auth', async () => {
    let requestUrl = ''
    let requestHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = init?.headers as Record<string, string>
      return jsonResponse({ results: [] })
    }))

    await tlDvConnector.executeRead!({
      source: source(),
      capabilityName: 'meetings.list',
      args: {
        query: 'renewal',
        page: 2,
        limit: 25,
        from: '2026-07-01T00:00:00.000Z',
        onlyParticipated: false,
        meetingType: 'external',
      },
      idempotencyKey: 'tldv-read-list',
    })

    const url = new URL(requestUrl)
    expect(`${url.origin}${url.pathname}`).toBe('https://pasta.tldv.io/v1alpha1/meetings')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: 'renewal',
      page: '2',
      limit: '25',
      from: '2026-07-01T00:00:00.000Z',
      onlyParticipated: 'false',
      meetingType: 'external',
    })
    expect(requestHeaders['x-api-key']).toBe('tldv_secret')
    expect(requestHeaders.authorization).toBeUndefined()
  })

  it('imports a recording through the documented /meetings/import route', async () => {
    let requestUrl = ''
    let requestBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = JSON.parse(init?.body as string) as Record<string, unknown>
      return jsonResponse({ success: true, jobId: 'job_1' }, 201)
    }))

    await tlDvConnector.executeMutation!({
      source: source(),
      capabilityName: 'meetings.upload',
      args: {
        name: 'Customer renewal',
        url: 'https://media.example.com/renewal.mp4',
        dryRun: false,
        participants: ['buyer@example.com', 'rep@example.com'],
      },
      idempotencyKey: 'tldv-import-1',
    })

    expect(requestUrl).toBe('https://pasta.tldv.io/v1alpha1/meetings/import')
    expect(requestBody).toEqual({
      name: 'Customer renewal',
      url: 'https://media.example.com/renewal.mp4',
      dryRun: false,
      participants: ['buyer@example.com', 'rep@example.com'],
    })
  })

  it('retrieves transcript and highlight routes without inventing write actions', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input))
      return jsonResponse({ data: [] })
    }))

    await tlDvConnector.executeRead!({
      source: source(),
      capabilityName: 'transcripts.get',
      args: { meetingId: 'mtg_1' },
      idempotencyKey: 'tldv-read-transcript-1',
    })
    await tlDvConnector.executeRead!({
      source: source(),
      capabilityName: 'highlights.get',
      args: { meetingId: 'mtg_1' },
      idempotencyKey: 'tldv-read-highlights-1',
    })

    expect(urls).toEqual([
      'https://pasta.tldv.io/v1alpha1/meetings/mtg_1/transcript',
      'https://pasta.tldv.io/v1alpha1/meetings/mtg_1/highlights',
    ])
  })

  it('surfaces rejected tl;dv credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(tlDvConnector.executeRead!({
      source: source(),
      capabilityName: 'meetings.list',
      args: {},
      idempotencyKey: 'tldv-rejected-list',
    })).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
