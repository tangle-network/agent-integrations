import { afterEach, describe, expect, it, vi } from 'vitest'
import { signwellConnector } from '../signwell.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_signwell',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'signwell',
  label: 'SignWell',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'signwell-key' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('signwell adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(signwellConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and other classification', () => {
    expect(signwellConnector.manifest.kind).toBe('signwell')
    expect(signwellConnector.manifest.displayName).toBe('SignWell')
    expect(signwellConnector.manifest.category).toBe('other')
    expect(signwellConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = signwellConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['account.get', 'documents.create', 'documents.get', 'documents.list'])
    const reads = signwellConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = signwellConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['account.get', 'documents.get', 'documents.list'])
    expect(mutations).toEqual(['documents.create'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof signwellConnector.executeRead).toBe('function')
    expect(typeof signwellConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of signwellConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes documents.list as GET /api/v1/documents', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await signwellConnector.executeRead!({ source, capabilityName: 'documents.list', args: {"page":1,"limit":25}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v1/documents')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('signwell-key')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('limit')).toBe('25')
  })

  it('routes documents.create as POST /api/v1/documents', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await signwellConnector.executeMutation!({ source, capabilityName: 'documents.create', args: {"test_mode":true,"draft":true,"files":[{"name":"contract.pdf","file_url":"https://example.com/contract.pdf"}],"recipients":[{"id":"1","name":"Jane Doe","email":"jane@example.com"}],"name":"x","subject":"x","message":"x","embedded_signing":true}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v1/documents')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('signwell-key')
    expect(JSON.parse(String(init.body))).toEqual({"files":[{"name":"contract.pdf","file_url":"https://example.com/contract.pdf"}],"recipients":[{"id":"1","name":"Jane Doe","email":"jane@example.com"}],"name":"x","subject":"x","message":"x","draft":true,"test_mode":true,"embedded_signing":true})
  })

  it('throws CredentialsExpired when SignWell rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      signwellConnector.executeRead!({ source, capabilityName: 'documents.list', args: {"page":1,"limit":25}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      signwellConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
