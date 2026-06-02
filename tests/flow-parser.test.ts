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

describe('flow-parser adapter manifest', () => {
  it('classifies itself as the other category and exposes the flow-parser kind', () => {
    expect(flowParserConnector.manifest.kind).toBe('flow-parser')
    expect(flowParserConnector.manifest.category).toBe('other')
    expect(flowParserConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = flowParserConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes flows.run alongside the document read/write surface', () => {
    const names = flowParserConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('flows.run')
    expect(names).toContain('documents.upload')
    expect(names).toContain('documents.delete')
  })

  it('marks flows.run as native-idempotency external effect', () => {
    const cap = flowParserConnector.manifest.capabilities.find((c) => c.name === 'flows.run')
    expect(cap).toBeDefined()
    if (!cap || cap.class !== 'mutation') throw new Error('unreachable')
    expect(cap.cas).toBe('native-idempotency')
    expect(cap.externalEffect).toBe(true)
  })
})

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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      flowParserConnector.executeMutation!({
        source: source(),
        capabilityName: 'flows.run',
        args: { flowId: 'flow-1', documentId: 'doc-9' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
