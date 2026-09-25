import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentproConnector } from '../src/connectors/adapters/documentpro.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_documentpro_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'documentpro',
    label: 'documentpro test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'documentpro_secret' },
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

describe('documentpro documents.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/documents/{document_id} with x-api-key header', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestHeaders: Record<string, string> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestHeaders = init?.headers as Record<string, string>
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await documentproConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.delete',
      args: { document_id: 'doc_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.documentpro.ai/v1/documents/doc_42')
    expect(requestHeaders['x-api-key']).toBe('documentpro_secret')
    expect(result.status).toBe('committed')
  })
})

describe('documentpro extraction.export', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v1/documents/{document_id}/export with format query', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ rows: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await documentproConnector.executeMutation!({
      source: source(),
      capabilityName: 'extraction.export',
      args: { document_id: 'doc_7', format: 'csv', template_id: 'tpl_1' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('https://api.documentpro.ai/v1/documents/doc_7/export')
    expect(String(requestUrl)).toContain('format=csv')
    expect(String(requestUrl)).toContain('template_id=tpl_1')
  })
})
