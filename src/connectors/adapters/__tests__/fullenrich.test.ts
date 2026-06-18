import { afterEach, describe, expect, it, vi } from 'vitest'
import { fullenrichConnector } from '../fullenrich.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_fullenrich',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'fullenrich',
  label: 'FullEnrich',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'fullenrich-key' },
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

describe('fullenrich adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(fullenrichConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and sales-intelligence classification', () => {
    expect(fullenrichConnector.manifest.kind).toBe('fullenrich')
    expect(fullenrichConnector.manifest.displayName).toBe('FullEnrich')
    expect(fullenrichConnector.manifest.category).toBe('sales-intelligence')
    expect(fullenrichConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = fullenrichConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['account.credits', 'contact.enrich.result', 'contact.enrich.start', 'contact.reverse_email.start'])
    const reads = fullenrichConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = fullenrichConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['account.credits', 'contact.enrich.result'])
    expect(mutations).toEqual(['contact.enrich.start', 'contact.reverse_email.start'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof fullenrichConnector.executeRead).toBe('function')
    expect(typeof fullenrichConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of fullenrichConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes account.credits as GET /api/v2/account/credits', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await fullenrichConnector.executeRead!({ source, capabilityName: 'account.credits', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/account/credits')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer fullenrich-key')
  })

  it('throws CredentialsExpired when FullEnrich rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      fullenrichConnector.executeRead!({ source, capabilityName: 'account.credits', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      fullenrichConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
