import { afterEach, describe, expect, it, vi } from 'vitest'
import { doctlyConnector } from '../src/connectors/adapters/doctly.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_doctly_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'doctly',
    label: 'doctly test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'doctly_secret' },
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

describe('doctly adapter manifest', () => {
  it('declares api-key auth as the catalog says', () => {
    const auth = doctlyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})

describe('doctly documents.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/v1/documents/{documentId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await doctlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.delete',
      args: { documentId: 'doc_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.doctly.ai/api/v1/documents/doc_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      doctlyConnector.executeMutation!({
        source: source(),
        capabilityName: 'documents.delete',
        args: { documentId: 'doc_42' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('doctly jobs.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/v1/documents/{documentId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await doctlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'jobs.cancel',
      args: { documentId: 'doc_99' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.doctly.ai/api/v1/documents/doc_99')
  })
})
