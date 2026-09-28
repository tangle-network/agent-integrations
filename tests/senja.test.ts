import { afterEach, describe, expect, it, vi } from 'vitest'
import { senjaConnector } from '../src/connectors/adapters/senja.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_senja_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'senja',
    label: 'Senja test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'senja_secret' },
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

describe('senja testimonials.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues PATCH to /testimonials/{id} with body args', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 't_1', approved: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await senjaConnector.executeMutation!({
      source: source(),
      capabilityName: 'testimonials.update',
      args: { id: 't_1', approved: true, title: 'Edited' },
      idempotencyKey: 'upd-1',
    })

    expect(capturedMethod).toBe('PATCH')
    expect(capturedUrl).toBe('https://api.senja.io/api/v1/testimonials/t_1')
    expect(capturedBody).toMatchObject({ id: 't_1', approved: true, title: 'Edited' })
    expect(result.status).toBe('committed')
  })
})

describe('senja testimonials.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE to /testimonials/{id}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await senjaConnector.executeMutation!({
      source: source(),
      capabilityName: 'testimonials.delete',
      args: { id: 't_42' },
      idempotencyKey: 'del-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.senja.io/api/v1/testimonials/t_42')
    expect(result.status).toBe('committed')
  })
})

describe('senja tags.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /tags with the tag fields', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'tag_1', name: 'VIP' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await senjaConnector.executeMutation!({
      source: source(),
      capabilityName: 'tags.create',
      args: { name: 'VIP', color: '#ff0000' },
      idempotencyKey: 'tag-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.senja.io/api/v1/tags')
    expect(capturedBody).toMatchObject({ name: 'VIP', color: '#ff0000' })
    expect(result.status).toBe('committed')
  })
})

describe('senja collections.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues GET to /collections', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ data: [{ id: 'c_1', name: 'Homepage' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await senjaConnector.executeRead!({
      source: source(),
      capabilityName: 'collections.list',
      args: { limit: 10 },
      idempotencyKey: 'read-1',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toContain('/api/v1/collections')
    expect(capturedUrl).toContain('limit=10')
    expect(result.data).toMatchObject({ data: [{ id: 'c_1' }] })
  })
})
