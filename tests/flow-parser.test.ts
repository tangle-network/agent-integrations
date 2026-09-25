import { afterEach, describe, expect, it, vi } from 'vitest'
import { flowParserConnector } from '../src/connectors/adapters/flow-parser.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_flow_parser_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'flow-parser',
    label: 'FlowParser test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'fp_secret' },
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

describe('flow-parser flows.run', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/flows/{flowId}/run with documentId in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ runId: 'run-1', status: 'queued' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await flowParserConnector.executeMutation!({
      source: source(),
      capabilityName: 'flows.run',
      args: { flowId: 'flow-1', documentId: 'doc-9' },
      idempotencyKey: 'k-run-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/flows/flow-1/run')
    expect(requestBody).toMatchObject({ documentId: 'doc-9' })
    expect(result.status).toBe('committed')
  })

  it('rejects when required flowId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      flowParserConnector.executeMutation!({
        source: source(),
        capabilityName: 'flows.run',
        args: { documentId: 'doc-9' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: flowId/)
  })
})
