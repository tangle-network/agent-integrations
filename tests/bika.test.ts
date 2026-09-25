import { afterEach, describe, expect, it, vi } from 'vitest'
import { bikaConnector } from '../src/connectors/adapters/bika.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bika_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bika',
    label: 'Bika test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bika_secret' },
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

describe('bika adapter write execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a records.batchCreate payload at /v1/records/batch', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bikaConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.batchCreate',
      args: { records: [{ fields: { name: 'A' } }, { fields: { name: 'B' } }] },
      idempotencyKey: 'idem_bc',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.bika.ai/v1/records/batch')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({
      records: [{ fields: { name: 'A' } }, { fields: { name: 'B' } }],
    })
  })

  it('PATCHes records.batchUpdate at /v1/records/batch', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await bikaConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.batchUpdate',
      args: { records: [{ id: 'r1', fields: { name: 'A2' } }] },
      idempotencyKey: 'idem_bu',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.bika.ai/v1/records/batch')
  })

  it('POSTs tables.create scoped under the workspace path', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body == null ? undefined : String(init.body)
      return jsonResponse({ id: 't_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await bikaConnector.executeMutation!({
      source: source(),
      capabilityName: 'tables.create',
      args: { workspaceId: 'ws_1', name: 'Backlog', fields: [{ name: 'title', type: 'text' }] },
      idempotencyKey: 'idem_tc',
    })

    expect(requestUrl).toBe('https://api.bika.ai/v1/workspaces/ws_1/tables')
    expect(JSON.parse(requestBody ?? '{}')).toEqual({
      name: 'Backlog',
      fields: [{ name: 'title', type: 'text' }],
    })
  })
})
