import { afterEach, describe, expect, it, vi } from 'vitest'
import { gongConnector } from '../gong.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const ACCESS_TOKEN = 'gong_at_test'

function source(metadata: Record<string, unknown> = {}): ResolvedDataSource {
  return {
    id: 'src_gong',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'gong',
    label: 'Gong',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata,
    credentials: { kind: 'oauth2', accessToken: ACCESS_TOKEN },
    status: 'active',
  }
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

describe('gong adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(gongConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares authorization_code oauth2 against app.gong.io with comms classification', () => {
    const auth = gongConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth narrowing failed')
    expect(auth.authorizationUrl).toBe('https://app.gong.io/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://app.gong.io/oauth2/generate-customer-token')
    expect(auth.clientIdEnv).toBe('GONG_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('GONG_OAUTH_CLIENT_SECRET')
    expect(gongConnector.manifest.category).toBe('comms')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const names = gongConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'calls.create',
      'calls.getExtensive',
      'calls.getTranscripts',
      'calls.list',
      'flows.assignProspects',
      'users.list',
    ])
    const mutations = gongConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(mutations).toEqual(['calls.create', 'flows.assignProspects'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof gongConnector.executeRead).toBe('function')
    expect(typeof gongConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of gongConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('falls back to api.gong.io and prefixes /v2 when no per-customer base URL is present', async () => {
    const fetchMock = mockFetch({ users: [] })
    await gongConnector.executeRead!({ source: source(), capabilityName: 'users.list', args: {}, idempotencyKey: 'op_0' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://api.gong.io')
    expect(url.pathname).toBe('/v2/users')
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
  })

  it('targets the per-customer base URL from metadata.apiBaseUrlForCustomer when present', async () => {
    const fetchMock = mockFetch({ calls: [] })
    await gongConnector.executeRead!({
      source: source({ apiBaseUrlForCustomer: 'https://company-17.api.gong.io' }),
      capabilityName: 'calls.list',
      args: { fromDateTime: '2026-01-01T00:00:00Z' },
      idempotencyKey: 'op_1',
    })
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://company-17.api.gong.io')
    expect(url.pathname).toBe('/v2/calls')
    expect(url.searchParams.get('fromDateTime')).toBe('2026-01-01T00:00:00Z')
  })

  it('retrieves transcripts via POST /v2/calls/transcript forwarding the filter object', async () => {
    const fetchMock = mockFetch({ callTranscripts: [] })
    await gongConnector.executeRead!({
      source: source(),
      capabilityName: 'calls.getTranscripts',
      args: { filter: { callIds: ['c1', 'c2'] } },
      idempotencyKey: 'op_2',
    })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/calls/transcript')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ filter: { callIds: ['c1', 'c2'] } })
  })

  it('assigns prospects to an Engage flow via POST /v2/flows/prospects/assign', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await gongConnector.executeMutation!({
      source: source(),
      capabilityName: 'flows.assignProspects',
      args: { flowId: 'flow_1', prospects: [{ crmProspectId: 'p1' }] },
      idempotencyKey: 'op_3',
    })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/flows/prospects/assign')
    expect(JSON.parse(String(init.body))).toEqual({ flowId: 'flow_1', prospects: [{ crmProspectId: 'p1' }] })
  })

  it('throws CredentialsExpired when Gong rejects the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      gongConnector.executeRead!({ source: source(), capabilityName: 'users.list', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      gongConnector.executeRead!({ source: source(), capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
