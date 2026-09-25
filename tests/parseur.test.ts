import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseurConnector } from '../src/connectors/adapters/parseur.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_parseur_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'parseur',
    label: 'parseur test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'parseur_secret' },
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

describe('parseur adapter manifest', () => {
  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = parseurConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Parseur/i)
  })

})

describe('parseur documents.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /documents/{documentId}', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await parseurConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.delete',
      args: { documentId: 'doc_1' },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.parseur.com/api/v2/documents/doc_1')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      parseurConnector.executeMutation!({
        source: source(),
        capabilityName: 'documents.delete',
        args: { documentId: 'doc_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('parseur templates.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /parsers/{parserId}/templates', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse([{ id: 'tpl_1' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await parseurConnector.executeRead!({
      source: source(),
      capabilityName: 'templates.list',
      args: { parserId: 'mb_1' },
      idempotencyKey: 'k-list',
    })

    expect(requestMethod).toBe('GET')
    expect(requestUrl).toBe('https://api.parseur.com/api/v2/parsers/mb_1/templates')
    expect(result.data).toEqual([{ id: 'tpl_1' }])
  })
})

describe('parseur templates.train', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs feedback to /templates/{templateId}/train', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await parseurConnector.executeMutation!({
      source: source(),
      capabilityName: 'templates.train',
      args: {
        templateId: 'tpl_1',
        document_id: 'doc_1',
        fields: [{ name: 'total', value: '42.00' }],
      },
      idempotencyKey: 'k-train',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.parseur.com/api/v2/templates/tpl_1/train')
    const parsed = JSON.parse(requestBody) as Record<string, unknown>
    expect(parsed.document_id).toBe('doc_1')
    expect(parsed.fields).toEqual([{ name: 'total', value: '42.00' }])
    expect(result.status).toBe('committed')
  })
})

describe('parseur mailboxes.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /parsers without required args', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse([{ id: 'mb_1' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await parseurConnector.executeRead!({
      source: source(),
      capabilityName: 'mailboxes.list',
      args: {},
      idempotencyKey: 'k-mb',
    })

    expect(requestMethod).toBe('GET')
    expect(requestUrl).toBe('https://api.parseur.com/api/v2/parsers')
    expect(result.data).toEqual([{ id: 'mb_1' }])
  })
})
