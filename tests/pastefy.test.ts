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

describe('pastefy adapter manifest', () => {
  it('classifies itself as the other category and exposes the pastefy kind', () => {
    expect(pastefyConnector.manifest.kind).toBe('pastefy')
    expect(pastefyConnector.manifest.category).toBe('other')
    expect(pastefyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = pastefyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers paste lifecycle plus folder management and share-link generation', () => {
    const names = pastefyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'folders.create',
        'folders.list',
        'pastes.create',
        'pastes.delete',
        'pastes.get',
        'pastes.list',
        'pastes.share',
        'pastes.update',
      ].sort(),
    )
    const reads = pastefyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = pastefyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['folders.list', 'pastes.get', 'pastes.list'].sort())
    expect(mutations).toEqual(
      [
        'folders.create',
        'pastes.create',
        'pastes.delete',
        'pastes.share',
        'pastes.update',
      ].sort(),
    )
  })

  it('marks the new write capabilities as native-idempotency external-effect', () => {
    for (const name of ['pastes.update', 'folders.create', 'pastes.share']) {
      const cap = pastefyConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      pastefyConnector.executeMutation!({
        source: source(),
        capabilityName: 'pastes.update',
        args: { paste_id: 'p_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
