import { afterEach, describe, expect, it, vi } from 'vitest'
import { expandiConnector } from '../expandi.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_expandi',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'expandi',
  label: 'Expandi',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'expandi-key' },
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

describe('expandi adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(expandiConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and crm classification', () => {
    expect(expandiConnector.manifest.kind).toBe('expandi')
    expect(expandiConnector.manifest.displayName).toBe('Expandi')
    expect(expandiConnector.manifest.category).toBe('crm')
    expect(expandiConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = expandiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['campaign_instance.create_contact', 'campaign_instances.list', 'li_account.connection_request', 'li_account.message', 'li_accounts.list'])
    const reads = expandiConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = expandiConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['campaign_instances.list', 'li_accounts.list'])
    expect(mutations).toEqual(['campaign_instance.create_contact', 'li_account.connection_request', 'li_account.message'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof expandiConnector.executeRead).toBe('function')
    expect(typeof expandiConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of expandiConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes li_accounts.list as GET /api/v1/open-api/v2/li_accounts/', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await expandiConnector.executeRead!({ source, capabilityName: 'li_accounts.list', args: {"secret":"sk_secret_value"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v1/open-api/v2/li_accounts/')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['key']).toBe('expandi-key')
  })

  it('throws CredentialsExpired when Expandi rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      expandiConnector.executeRead!({ source, capabilityName: 'li_accounts.list', args: {"secret":"sk_secret_value"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      expandiConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
