import { afterEach, describe, expect, it, vi } from 'vitest'
import { demandbaseConnector } from '../demandbase.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const ACCESS_TOKEN = 'demandbase_jwt_test'

const source: ResolvedDataSource = {
  id: 'src_demandbase',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'demandbase',
  label: 'Demandbase',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  // client_credentials grant: the hub exchanges the API Key Set and stores
  // the resulting JWT as an oauth2 access token.
  credentials: { kind: 'oauth2', accessToken: ACCESS_TOKEN },
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

describe('demandbase adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(demandbaseConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares a client_credentials oauth2 grant with no authorize URL and sales-intelligence classification', () => {
    const auth = demandbaseConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth narrowing failed')
    expect(auth.grantType).toBe('client_credentials')
    expect(auth.authorizationUrl).toBeUndefined()
    expect(auth.tokenUrl).toBe('https://uapi.demandbase.com/auth/v1/token')
    expect(auth.clientIdEnv).toBe('DEMANDBASE_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('DEMANDBASE_OAUTH_CLIENT_SECRET')
    expect(demandbaseConnector.manifest.category).toBe('sales-intelligence')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const names = demandbaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['users.create', 'users.get', 'users.list'])
    const reads = demandbaseConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = demandbaseConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['users.get', 'users.list'])
    expect(mutations).toEqual(['users.create'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof demandbaseConnector.executeRead).toBe('function')
    expect(typeof demandbaseConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of demandbaseConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('lists users via GET /admin/v1/users (plural) with bearer auth', async () => {
    const fetchMock = mockFetch({ users: [] })
    await demandbaseConnector.executeRead!({ source, capabilityName: 'users.list', args: { limit: 10 }, idempotencyKey: 'op_0' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://uapi.demandbase.com')
    expect(url.pathname).toBe('/admin/v1/users')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(url.searchParams.get('limit')).toBe('10')
  })

  it('reads a single user via GET /admin/v1/user/{userId} (singular)', async () => {
    const fetchMock = mockFetch({ id: 'u1' })
    await demandbaseConnector.executeRead!({ source, capabilityName: 'users.get', args: { userId: 'u1' }, idempotencyKey: 'op_1' })
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/admin/v1/user/u1')
  })

  it('creates a user via POST /admin/v1/user (singular) forwarding the args body', async () => {
    const fetchMock = mockFetch({ id: 'u2' })
    const result = await demandbaseConnector.executeMutation!({
      source,
      capabilityName: 'users.create',
      args: { email: 'a@b.com', first_name: 'Ada', last_name: 'L', role: 'analyst' },
      idempotencyKey: 'op_2',
    })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/admin/v1/user')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.com', first_name: 'Ada', last_name: 'L', role: 'analyst' })
  })

  it('throws CredentialsExpired when Demandbase rejects the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      demandbaseConnector.executeRead!({ source, capabilityName: 'users.list', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      demandbaseConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
