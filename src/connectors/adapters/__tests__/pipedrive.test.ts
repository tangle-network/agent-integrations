import { afterEach, describe, expect, it, vi } from 'vitest'
import { pipedriveConnector } from '../pipedrive.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_pipedrive',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'pipedrive',
  label: 'Pipedrive (Acme)',
  consistencyModel: 'authoritative',
  scopes: ['deals:full', 'contacts:full'],
  metadata: { apiDomain: 'https://acme.pipedrive.com' },
  credentials: { kind: 'oauth2', accessToken: 'token_abc' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pipedrive adapter manifest', () => {
  it('declares the expected OAuth2 endpoints, scopes, and env-var names', () => {
    const auth = pipedriveConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://oauth.pipedrive.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://oauth.pipedrive.com/oauth/token')
    expect(auth.scopes).toEqual(['deals:full', 'contacts:full', 'leads:full', 'activities:full'])
    expect(auth.clientIdEnv).toBe('PIPEDRIVE_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('PIPEDRIVE_OAUTH_CLIENT_SECRET')
  })

  it('exposes the CRM action pack (deals, persons, organizations) split between reads and mutations', () => {
    const names = pipedriveConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'deals.search',
        'deals.get',
        'deals.create',
        'deals.update',
        'persons.search',
        'persons.create',
        'organizations.search',
        'organizations.create',
      ].sort(),
    )
    const reads = pipedriveConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    const mutations = pipedriveConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name)
    expect(reads.sort()).toEqual(['deals.get', 'deals.search', 'organizations.search', 'persons.search'])
    expect(mutations.sort()).toEqual(['deals.create', 'deals.update', 'organizations.create', 'persons.create'])
  })

  it('classifies itself as crm with authoritative consistency', () => {
    expect(pipedriveConnector.manifest.kind).toBe('pipedrive')
    expect(pipedriveConnector.manifest.category).toBe('crm')
    expect(pipedriveConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })
})

describe('pipedrive adapter execution', () => {
  it('builds a search URL against the per-account api_domain with bearer auth and interpolated query', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: { items: [{ item: { id: 1, title: 'Big deal' } }] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'deals.search',
      args: { term: 'tangle', limit: 25 },
      idempotencyKey: 'idem_1',
    }
    const result = await pipedriveConnector.executeRead!(invocation)

    expect(result.data).toEqual({ data: { items: [{ item: { id: 1, title: 'Big deal' } }] } })
    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe('https://acme.pipedrive.com/v1/deals/search?term=tangle&limit=25')
    expect((call[1]!.headers as Record<string, string>).authorization).toBe('Bearer token_abc')
  })

  it('falls back to the shared api host when apiDomain metadata is absent', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: { id: 42 } }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const fallbackSource: ResolvedDataSource = { ...source, metadata: {} }
    const invocation: ConnectorInvocation = {
      source: fallbackSource,
      capabilityName: 'deals.create',
      args: { title: 'New deal', value: 1000, currency: 'USD' },
      idempotencyKey: 'idem_2',
    }
    const result = await pipedriveConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe('https://api.pipedrive.com/v1/deals')
    expect(call[1]!.method).toBe('POST')
    expect(JSON.parse(String(call[1]!.body))).toEqual({ title: 'New deal', value: 1000, currency: 'USD' })
  })

  it('throws CredentialsExpired when Pipedrive rejects the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('expired', { status: 401 })),
    )
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'deals.get',
      args: { id: 5 },
      idempotencyKey: 'idem_3',
    }
    await expect(pipedriveConnector.executeRead!(invocation)).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
