import { afterEach, describe, expect, it, vi } from 'vitest'
import { ringcentralConnector } from '../ringcentral.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const ACCESS_TOKEN = 'ringcentral_at_test'

const source: ResolvedDataSource = {
  id: 'src_ringcentral',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'ringcentral',
  label: 'RingCentral',
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

describe('ringcentral adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(ringcentralConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares authorization_code oauth2 against platform.ringcentral.com with comms classification', () => {
    const auth = ringcentralConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth narrowing failed')
    expect(auth.authorizationUrl).toBe('https://platform.ringcentral.com/restapi/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://platform.ringcentral.com/restapi/oauth/token')
    expect(auth.clientIdEnv).toBe('RINGCENTRAL_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('RINGCENTRAL_OAUTH_CLIENT_SECRET')
    expect(ringcentralConnector.manifest.category).toBe('comms')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const names = ringcentralConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'callLog.list',
      'extension.get',
      'extensions.list',
      'messages.list',
      'sms.send',
      'subscriptions.create',
    ])
    const mutations = ringcentralConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(mutations).toEqual(['sms.send', 'subscriptions.create'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof ringcentralConnector.executeRead).toBe('function')
    expect(typeof ringcentralConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of ringcentralConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes extension.get against the ~ alias path under /restapi/v1.0 with bearer auth', async () => {
    const fetchMock = mockFetch({ id: '1' })
    await ringcentralConnector.executeRead!({ source, capabilityName: 'extension.get', args: {}, idempotencyKey: 'op_0' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://platform.ringcentral.com')
    expect(url.pathname).toBe('/restapi/v1.0/account/~/extension/~')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
  })

  it('sends an SMS via POST /account/~/extension/~/sms forwarding from/to/text', async () => {
    const fetchMock = mockFetch({ id: 'msg_1' })
    const result = await ringcentralConnector.executeMutation!({
      source,
      capabilityName: 'sms.send',
      args: { from: { phoneNumber: '+14155550100' }, to: [{ phoneNumber: '+14155550111' }], text: 'Hi' },
      idempotencyKey: 'op_1',
    })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/restapi/v1.0/account/~/extension/~/sms')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(JSON.parse(String(init.body))).toEqual({
      from: { phoneNumber: '+14155550100' },
      to: [{ phoneNumber: '+14155550111' }],
      text: 'Hi',
    })
  })

  it('throws CredentialsExpired when RingCentral rejects the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      ringcentralConnector.executeRead!({ source, capabilityName: 'extension.get', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      ringcentralConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
