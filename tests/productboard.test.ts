import { afterEach, describe, expect, it, vi } from 'vitest'
import { productboardConnector } from '../src/connectors/adapters/productboard.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_productboard_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'productboard',
    label: 'productboard test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'pb_secret' },
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

describe('productboard features.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /features/{featureId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await productboardConnector.executeMutation!({
      source: source(),
      capabilityName: 'features.delete',
      args: { featureId: 'feat_abc' },
      idempotencyKey: 'k-fd-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.productboard.com/v1/features/feat_abc')
  })
})

describe('productboard notes.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues PATCH /notes/{noteId} with the bearer token and args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestHeaders: Headers | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestHeaders = new Headers(init?.headers)
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'note_1', title: 'updated' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await productboardConnector.executeMutation!({
      source: source(),
      capabilityName: 'notes.update',
      args: { noteId: 'note_1', title: 'updated' },
      idempotencyKey: 'k-nu-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toBe('https://api.productboard.com/v1/notes/note_1')
    expect(requestHeaders!.get('authorization')).toBe('Bearer pb_secret')
    expect(JSON.parse(requestBody!)).toEqual({ noteId: 'note_1', title: 'updated' })
  })
})

describe('productboard notes.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /notes/{noteId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await productboardConnector.executeMutation!({
      source: source(),
      capabilityName: 'notes.delete',
      args: { noteId: 'note_xyz' },
      idempotencyKey: 'k-nd-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.productboard.com/v1/notes/note_xyz')
  })
})

describe('productboard components.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues POST /components with the body args', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'comp_1', name: 'Billing' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await productboardConnector.executeMutation!({
      source: source(),
      capabilityName: 'components.create',
      args: { name: 'Billing', description: 'Billing surface' },
      idempotencyKey: 'k-cc-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.productboard.com/v1/components')
    expect(JSON.parse(requestBody!)).toEqual({
      name: 'Billing',
      description: 'Billing surface',
    })
  })
})
