import { afterEach, describe, expect, it, vi } from 'vitest'
import { airparserConnector } from '../src/connectors/adapters/airparser.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_airparser_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'airparser',
    label: 'airparser test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'airparser_secret' },
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

describe('airparser adapter manifest', () => {
  it('classifies itself as the doc category and exposes the airparser kind', () => {
    expect(airparserConnector.manifest.kind).toBe('airparser')
    expect(airparserConnector.manifest.category).toBe('doc')
    expect(airparserConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = airparserConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/airparser/i)
  })

  it('covers document upload, extraction, retrieval, deletion, reprocessing, and inbox creation', () => {
    const names = airparserConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'documents.extract',
        'documents.get',
        'documents.upload',
        'documents.delete',
        'documents.reprocess',
        'inbox.create',
      ].sort(),
    )
    const mutations = airparserConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'documents.upload',
        'documents.delete',
        'documents.reprocess',
        'inbox.create',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    for (const name of ['documents.delete', 'documents.reprocess', 'inbox.create']) {
      const cap = airparserConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('airparser documents.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/documents/{documentId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await airparserConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.delete',
      args: { documentId: 'doc_42' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.airparser.com/v1/documents/doc_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      airparserConnector.executeMutation!({
        source: source(),
        capabilityName: 'documents.delete',
        args: { documentId: 'doc_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('airparser documents.reprocess', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/documents/{documentId}/reprocess', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'queued' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await airparserConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.reprocess',
      args: { documentId: 'doc_7' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.airparser.com/v1/documents/doc_7/reprocess')
  })
})

describe('airparser inbox.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/inboxes with the inbox body', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'inbox_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await airparserConnector.executeMutation!({
      source: source(),
      capabilityName: 'inbox.create',
      args: { name: 'Invoices', description: '' },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.airparser.com/v1/inboxes')
    expect(requestBody).toMatchObject({ name: 'Invoices' })
  })
})
