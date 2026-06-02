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
  it('classifies itself as the storage category and exposes the pdfmonkey kind', () => {
    expect(pdfmonkeyConnector.manifest.kind).toBe('pdfmonkey')
    expect(pdfmonkeyConnector.manifest.category).toBe('storage')
    expect(pdfmonkeyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = pdfmonkeyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus the new templates/share/regenerate surface', () => {
    const names = pdfmonkeyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'documents.delete',
        'documents.find',
        'documents.generate',
        'documents.list',
        'documents.regenerate',
        'documents.share',
        'templates.list',
      ].sort(),
    )
    const reads = pdfmonkeyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = pdfmonkeyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['documents.find', 'documents.list', 'templates.list'].sort())
    expect(mutations).toEqual(
      [
        'documents.delete',
        'documents.generate',
        'documents.regenerate',
        'documents.share',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    for (const cap of pdfmonkeyConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas, `${cap.name} cas`).toBe('native-idempotency')
      expect(cap.externalEffect, `${cap.name} externalEffect`).toBe(true)
    }
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
