import { afterEach, describe, expect, it, vi } from 'vitest'
import { salesloftConnector } from '../salesloft.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const ACCESS_TOKEN = 'salesloft_at_test'

const source: ResolvedDataSource = {
  id: 'src_salesloft',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'salesloft',
  label: 'Salesloft',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
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

describe('salesloft adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(salesloftConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares authorization_code oauth2 against accounts.salesloft.com with crm classification', () => {
    const auth = salesloftConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth narrowing failed')
    expect(auth.authorizationUrl).toBe('https://accounts.salesloft.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://accounts.salesloft.com/oauth/token')
    expect(auth.clientIdEnv).toBe('SALESLOFT_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('SALESLOFT_OAUTH_CLIENT_SECRET')
    expect(salesloftConnector.manifest.category).toBe('crm')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const names = salesloftConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'accounts.create',
      'cadence_memberships.create',
      'cadences.list',
      'me.get',
      'people.create',
      'people.list',
    ])
    const reads = salesloftConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = salesloftConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['cadences.list', 'me.get', 'people.list'])
    expect(mutations).toEqual(['accounts.create', 'cadence_memberships.create', 'people.create'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof salesloftConnector.executeRead).toBe('function')
    expect(typeof salesloftConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of salesloftConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes me.get as GET /v2/me (no .json suffix) with bearer auth', async () => {
    const fetchMock = mockFetch({ data: { id: 1 } })
    await salesloftConnector.executeRead!({ source, capabilityName: 'me.get', args: {}, idempotencyKey: 'op_0' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://api.salesloft.com')
    expect(url.pathname).toBe('/v2/me')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
  })

  it('enrolls a person into a cadence via POST /v2/cadence_memberships forwarding the args body', async () => {
    const fetchMock = mockFetch({ data: { id: 7 } })
    const result = await salesloftConnector.executeMutation!({
      source,
      capabilityName: 'cadence_memberships.create',
      args: { person_id: 42, cadence_id: 9 },
      idempotencyKey: 'op_1',
    })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/cadence_memberships')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(JSON.parse(String(init.body))).toEqual({ person_id: 42, cadence_id: 9 })
  })

  it('throws CredentialsExpired when Salesloft rejects the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      salesloftConnector.executeRead!({ source, capabilityName: 'me.get', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      salesloftConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
