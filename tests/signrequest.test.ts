import { afterEach, describe, expect, it, vi } from 'vitest'
import { signrequestConnector } from '../src/connectors/adapters/signrequest.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_signrequest_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'signrequest',
    label: 'Signrequest test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'signrequest_secret' },
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

describe('signrequest requests.remind', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /signrequests/{requestId}/resend_signrequest_email/', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signrequestConnector.executeMutation!({
      source: source(),
      capabilityName: 'requests.remind',
      args: { requestId: 'req_42' },
      idempotencyKey: 'rem-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://signrequest.com/api/v1/signrequests/req_42/resend_signrequest_email/')
    expect(result.status).toBe('committed')
  })
})

describe('signrequest requests.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE to /signrequests/{requestId}/ and accepts a 204 no-content response', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signrequestConnector.executeMutation!({
      source: source(),
      capabilityName: 'requests.delete',
      args: { requestId: 'req_99' },
      idempotencyKey: 'del-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://signrequest.com/api/v1/signrequests/req_99/')
    expect(result.status).toBe('committed')
  })
})

describe('signrequest documents.upload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /documents/ with the provided fields', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ uuid: 'doc_1', name: 'NDA.pdf' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signrequestConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.upload',
      args: { file_from_url: 'https://example.com/file.pdf', name: 'NDA.pdf' },
      idempotencyKey: 'upl-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://signrequest.com/api/v1/documents/')
    expect(capturedBody).toMatchObject({
      file_from_url: 'https://example.com/file.pdf',
      name: 'NDA.pdf',
    })
    expect(result.status).toBe('committed')
  })
})

describe('signrequest templates.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues GET to /templates/', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ results: [{ uuid: 'tpl_1' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await signrequestConnector.executeRead!({
      source: source(),
      capabilityName: 'templates.list',
      args: { limit: 5 },
      idempotencyKey: 'read-1',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toContain('/api/v1/templates/')
    expect(capturedUrl).toContain('limit=5')
    expect(result.data).toMatchObject({ results: [{ uuid: 'tpl_1' }] })
  })
})
