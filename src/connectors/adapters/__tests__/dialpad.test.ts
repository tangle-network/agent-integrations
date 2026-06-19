import { afterEach, describe, expect, it, vi } from 'vitest'
import { dialpadConnector } from '../dialpad.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const ACCESS_TOKEN = 'dialpad_at_test'

const source: ResolvedDataSource = {
  id: 'src_dialpad',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'dialpad',
  label: 'Dialpad',
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

describe('dialpad adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(dialpadConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares authorization_code oauth2 against dialpad.com with comms classification', () => {
    const auth = dialpadConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth narrowing failed')
    expect(auth.authorizationUrl).toBe('https://dialpad.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://dialpad.com/oauth2/token')
    expect(auth.clientIdEnv).toBe('DIALPAD_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('DIALPAD_OAUTH_CLIENT_SECRET')
    expect(dialpadConnector.manifest.category).toBe('comms')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const names = dialpadConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['calls.get', 'calls.list', 'contacts.create', 'contacts.list', 'sms.send', 'users.list'])
    const reads = dialpadConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = dialpadConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['calls.get', 'calls.list', 'contacts.list', 'users.list'])
    expect(mutations).toEqual(['contacts.create', 'sms.send'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof dialpadConnector.executeRead).toBe('function')
    expect(typeof dialpadConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of dialpadConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes calls.list as GET /api/v2/call (singular) with bearer auth', async () => {
    const fetchMock = mockFetch({ items: [] })
    await dialpadConnector.executeRead!({ source, capabilityName: 'calls.list', args: { started_after: 1700000000000 }, idempotencyKey: 'op_0' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://dialpad.com')
    expect(url.pathname).toBe('/api/v2/call')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(url.searchParams.get('started_after')).toBe('1700000000000')
  })

  it('routes calls.get to /api/v2/call/{id}', async () => {
    const fetchMock = mockFetch({ id: '5' })
    await dialpadConnector.executeRead!({ source, capabilityName: 'calls.get', args: { id: 5 }, idempotencyKey: 'op_1' })
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/call/5')
  })

  it('sends an SMS via POST /api/v2/sms forwarding the args body', async () => {
    const fetchMock = mockFetch({ id: 'sms_1' })
    const result = await dialpadConnector.executeMutation!({
      source,
      capabilityName: 'sms.send',
      args: { to_numbers: ['+14155550111'], text: 'Hello', user_id: 99 },
      idempotencyKey: 'op_2',
    })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/sms')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(JSON.parse(String(init.body))).toEqual({ to_numbers: ['+14155550111'], text: 'Hello', user_id: 99 })
  })

  it('throws CredentialsExpired when Dialpad rejects the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      dialpadConnector.executeRead!({ source, capabilityName: 'calls.list', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      dialpadConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
