import { afterEach, describe, expect, it, vi } from 'vitest'
import { pastefyConnector } from '../src/connectors/adapters/pastefy.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_pastefy_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'pastefy',
    label: 'pastefy test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { instance_url: 'https://paste.example.com' },
    credentials: { kind: 'api-key', apiKey: 'pastefy_secret' },
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

describe('pastefy pastes.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /api/v1/pastes/{paste_id} with title and content', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return jsonResponse({ id: 'p_1', title: 'new title' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pastefyConnector.executeMutation!({
      source: source(),
      capabilityName: 'pastes.update',
      args: { paste_id: 'p_1', title: 'new title', content: 'updated body' },
      idempotencyKey: 'k-update',
    })

    expect(requestMethod).toBe('PUT')
    expect(requestUrl).toBe('https://paste.example.com/api/v1/pastes/p_1')
    const parsed = JSON.parse(requestBody) as Record<string, unknown>
    expect(parsed.title).toBe('new title')
    expect(parsed.content).toBe('updated body')
    expect(result.status).toBe('committed')
  })
})

describe('pastefy folders.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/v1/folders', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse([{ id: 'f_1', name: 'work' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pastefyConnector.executeRead!({
      source: source(),
      capabilityName: 'folders.list',
      args: {},
      idempotencyKey: 'k-list',
    })

    expect(requestMethod).toBe('GET')
    expect(requestUrl).toBe('https://paste.example.com/api/v1/folders')
    expect(result.data).toEqual([{ id: 'f_1', name: 'work' }])
  })
})

describe('pastefy folders.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v1/folders with a forwarded name', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = typeof init?.body === 'string' ? init.body : ''
      return jsonResponse({ id: 'f_new', name: 'snippets' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pastefyConnector.executeMutation!({
      source: source(),
      capabilityName: 'folders.create',
      args: { name: 'snippets' },
      idempotencyKey: 'k-fold',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://paste.example.com/api/v1/folders')
    const parsed = JSON.parse(requestBody) as Record<string, unknown>
    expect(parsed.name).toBe('snippets')
    expect(result.status).toBe('committed')
  })
})

describe('pastefy pastes.share', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v1/pastes/{paste_id}/share', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ share_url: 'https://paste.example.com/s/abc123' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await pastefyConnector.executeMutation!({
      source: source(),
      capabilityName: 'pastes.share',
      args: { paste_id: 'p_1' },
      idempotencyKey: 'k-share',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://paste.example.com/api/v1/pastes/p_1/share')
    expect(result.status).toBe('committed')
  })
})
