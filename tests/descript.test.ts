import { afterEach, describe, expect, it, vi } from 'vitest'
import { descriptConnector } from '../src/connectors/adapters/descript.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_descript_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'descript',
    label: 'descript test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'descript_secret' },
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

describe('descript projects.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/projects/{project_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await descriptConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.delete',
      args: { project_id: 'proj_abc' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.descript.com/v1/projects/proj_abc')
  })
})
