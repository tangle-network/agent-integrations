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

describe('documentpro adapter manifest', () => {
  it('classifies itself under the doc category and exposes the documentpro kind', () => {
    expect(documentproConnector.manifest.kind).toBe('documentpro')
    expect(documentproConnector.manifest.category).toBe('doc')
    expect(documentproConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares an api-key auth surface (DocumentPro has no OAuth flow)', () => {
    const auth = documentproConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
  })

  it('exposes the run.extract capability plus the new write-side mutations', () => {
    const names = documentproConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['run.extract', 'documents.delete', 'extraction.export'].sort())
    const extract = documentproConnector.manifest.capabilities.find((c) => c.name === 'run.extract')
    if (!extract) throw new Error('run.extract capability missing')
    expect(extract.class).toBe('mutation')
  })

  it('marks new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['documents.delete', 'extraction.export']
    for (const name of expected) {
      const cap = documentproConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      documentproConnector.executeMutation!({
        source: source(),
        capabilityName: 'documents.delete',
        args: { document_id: 'doc_42' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
