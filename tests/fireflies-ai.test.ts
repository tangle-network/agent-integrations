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
})
