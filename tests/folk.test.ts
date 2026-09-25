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
})
