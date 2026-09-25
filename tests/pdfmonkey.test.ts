import { afterEach, describe, expect, it, vi } from 'vitest'
import { pdfmonkeyConnector } from '../src/connectors/adapters/pdfmonkey.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_pdfmonkey_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'pdfmonkey',
    label: 'pdfmonkey test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'pdfmonkey_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('pdfmonkey adapter manifest', () => {
  it('uses api-key auth', () => {
    const auth = pdfmonkeyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})

describe('pdfmonkey documents.share', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /documents/{documentId}/share_link with bearer auth', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let authHeader: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      const headers = new Headers(init?.headers ?? {})
      authHeader = headers.get('authorization') ?? undefined
      return jsonResponse({ share_link: { url: 'https://share/abc' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pdfmonkeyConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.share',
      args: { documentId: 'doc_42' },
      idempotencyKey: 'k-share',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.pdfmonkey.io/api/v1/documents/doc_42/share_link')
    expect(authHeader).toBe('Bearer pdfmonkey_secret')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      pdfmonkeyConnector.executeMutation!({
        source: source(),
        capabilityName: 'documents.share',
        args: { documentId: 'doc_42' },
        idempotencyKey: 'k-share',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('pdfmonkey documents.regenerate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /documents/{documentId}/regenerate', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'doc_42', status: 'pending' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pdfmonkeyConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.regenerate',
      args: { documentId: 'doc_42' },
      idempotencyKey: 'k-regen',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.pdfmonkey.io/api/v1/documents/doc_42/regenerate')
  })
})
