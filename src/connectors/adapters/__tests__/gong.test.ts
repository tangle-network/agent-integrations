import { afterEach, describe, expect, it, vi } from 'vitest'
import { gongConnector } from '../gong.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const ACCESS_TOKEN = 'gong_at_test'
// A normally-connected Gong source carries the per-customer host the hub
// persisted from the token exchange; tests that exercise real calls default
// to it. The fail-loud test below passes `source({})` to drop it.
const PER_CUSTOMER_BASE = 'https://company-17.api.gong.io'

function source(metadata: Record<string, unknown> = { apiBaseUrlForCustomer: PER_CUSTOMER_BASE }): ResolvedDataSource {
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

  it('declares a required tokenMetadata capture for the per-customer base URL', () => {
    // The contract that completeAuth honors: persist the token-exchange
    // `api_base_url_for_customer` into metadata.apiBaseUrlForCustomer (required).
    // The companion test below proves call-time `baseUrl` resolution reads that
    // same metadata key, closing the loop from token exchange to first call.
    const auth = gongConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('auth narrowing failed')
    expect(auth.tokenMetadata).toEqual({
      apiBaseUrlForCustomer: { field: 'api_base_url_for_customer', required: true },
    })
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

  it('fails loud (no silent fallback host) when the per-customer base URL is absent', async () => {
    // The generic api.gong.io host is invalid for OAuth apps, so a missing
    // metadata.apiBaseUrlForCustomer must throw rather than route to a host
    // where every call would fail while the connection looks active.
    const fetchMock = mockFetch({ users: [] })
    await expect(
      gongConnector.executeRead!({ source: source({}), capabilityName: 'users.list', args: {}, idempotencyKey: 'op_0' }),
    ).rejects.toThrow(/missing metadata\.apiBaseUrlForCustomer/)
    expect(fetchMock).not.toHaveBeenCalled()
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
