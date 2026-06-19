import { afterEach, describe, expect, it, vi } from 'vitest'
import { outreachConnector } from '../outreach.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const ACCESS_TOKEN = 'outreach_at_test'

const source: ResolvedDataSource = {
  id: 'src_outreach',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'outreach',
  label: 'Outreach',
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

describe('outreach adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(outreachConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares authorization_code oauth2 against api.outreach.io with crm classification', () => {
    const auth = outreachConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth narrowing failed')
    expect(auth.authorizationUrl).toBe('https://api.outreach.io/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.outreach.io/oauth/token')
    expect(auth.clientIdEnv).toBe('OUTREACH_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('OUTREACH_OAUTH_CLIENT_SECRET')
    expect(outreachConnector.manifest.category).toBe('crm')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const names = outreachConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'accounts.create',
      'opportunities.list',
      'prospects.create',
      'prospects.list',
      'prospects.update',
      'sequenceStates.create',
    ])
    const reads = outreachConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = outreachConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['opportunities.list', 'prospects.list'])
    expect(mutations).toEqual(['accounts.create', 'prospects.create', 'prospects.update', 'sequenceStates.create'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof outreachConnector.executeRead).toBe('function')
    expect(typeof outreachConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of outreachConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes prospects.list as GET /api/v2/prospects with the email filter and bearer auth', async () => {
    const fetchMock = mockFetch({ data: [] })
    await outreachConnector.executeRead!({ source, capabilityName: 'prospects.list', args: { email: 'ada@example.com' }, idempotencyKey: 'op_0' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://api.outreach.io')
    expect(url.pathname).toBe('/api/v2/prospects')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(url.searchParams.get('filter[emails][email]')).toBe('ada@example.com')
    // Unprovided params must be omitted, not sent empty.
    expect(url.searchParams.has('page[after]')).toBe(false)
  })

  it('wraps prospects.create in the JSON:API envelope, drops absent relationships, and pins the vnd.api+json media type', async () => {
    const fetchMock = mockFetch({ data: { id: '99', type: 'prospect' } })
    const attributes = { firstName: 'Ada', lastName: 'Lovelace', emails: [{ email: 'ada@example.com', emailType: 'work' }] }
    const result = await outreachConnector.executeMutation!({ source, capabilityName: 'prospects.create', args: { attributes }, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/prospects')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/vnd.api+json')
    expect(JSON.parse(String(init.body))).toEqual({ data: { type: 'prospect', attributes } })
  })

  it('enrolls a prospect into a sequence with a fully-specified JSON:API relationships envelope', async () => {
    const fetchMock = mockFetch({ data: { id: '5', type: 'sequenceState' } })
    await outreachConnector.executeMutation!({ source, capabilityName: 'sequenceStates.create', args: { prospectId: 123, sequenceId: 456 }, idempotencyKey: 'op_2' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v2/sequenceStates')
    expect(JSON.parse(String(init.body))).toEqual({
      data: {
        type: 'sequenceState',
        relationships: {
          prospect: { data: { type: 'prospect', id: 123 } },
          sequence: { data: { type: 'sequence', id: 456 } },
        },
      },
    })
  })

  it('throws CredentialsExpired when Outreach rejects the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      outreachConnector.executeRead!({ source, capabilityName: 'prospects.list', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      outreachConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
