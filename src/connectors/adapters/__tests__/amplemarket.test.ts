import { afterEach, describe, expect, it, vi } from 'vitest'
import { amplemarketConnector } from '../amplemarket.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_amplemarket',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'amplemarket',
  label: 'Amplemarket',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'amplemarket-key' },
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

describe('amplemarket adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(amplemarketConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and crm classification', () => {
    expect(amplemarketConnector.manifest.kind).toBe('amplemarket')
    expect(amplemarketConnector.manifest.displayName).toBe('Amplemarket')
    expect(amplemarketConnector.manifest.category).toBe('crm')
    expect(amplemarketConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = amplemarketConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['companies.find', 'email.validate', 'people.find', 'people.search', 'sequence.add_leads'])
    const reads = amplemarketConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = amplemarketConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['companies.find', 'people.search'])
    expect(mutations).toEqual(['email.validate', 'people.find', 'sequence.add_leads'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof amplemarketConnector.executeRead).toBe('function')
    expect(typeof amplemarketConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of amplemarketConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes companies.find as GET /companies/find', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await amplemarketConnector.executeRead!({ source, capabilityName: 'companies.find', args: {"domain":"stripe.com"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/companies/find')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer amplemarket-key')
    expect(url.searchParams.get('domain')).toBe('stripe.com')
  })

  it('throws CredentialsExpired when Amplemarket rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      amplemarketConnector.executeRead!({ source, capabilityName: 'companies.find', args: {"domain":"stripe.com"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      amplemarketConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
