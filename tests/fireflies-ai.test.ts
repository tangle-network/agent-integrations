import { afterEach, describe, expect, it, vi } from 'vitest'
import { firefliesAiConnector } from '../src/connectors/adapters/fireflies-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_fireflies_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'fireflies-ai',
    label: 'Fireflies test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'ff_secret' },
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

describe('fireflies-ai adapter manifest', () => {
  it('exposes the fireflies-ai kind under the doc category', () => {
    expect(firefliesAiConnector.manifest.kind).toBe('fireflies-ai')
    expect(firefliesAiConnector.manifest.category).toBe('doc')
    expect(firefliesAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = firefliesAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus transcript.delete write capability', () => {
    const names = firefliesAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'meetings.findById',
        'meetings.findRecent',
        'meetings.findByQuery',
        'audio.upload',
        'transcript.delete',
        'user.getDetails',
      ].sort(),
    )
    const reads = firefliesAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = firefliesAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['meetings.findById', 'meetings.findRecent', 'meetings.findByQuery', 'user.getDetails'].sort(),
    )
    expect(mutations).toEqual(['audio.upload', 'transcript.delete'].sort())
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const c of firefliesAiConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('fireflies-ai transcript.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a deleteTranscript GraphQL mutation against /graphql', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: { deleteTranscript: { id: 'tr_123', title: 'Standup' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await firefliesAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'transcript.delete',
      args: { variables: { transcriptId: 'tr_123' } },
      idempotencyKey: 'k-delete-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/graphql')
    expect(requestBody).toMatchObject({
      variables: { transcriptId: 'tr_123' },
    })
    expect(typeof (requestBody as { query?: string }).query).toBe('string')
    expect((requestBody as { query: string }).query).toContain('deleteTranscript')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      firefliesAiConnector.executeMutation!({
        source: source(),
        capabilityName: 'transcript.delete',
        args: { variables: { transcriptId: 'tr_123' } },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
