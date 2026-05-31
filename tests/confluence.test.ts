import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  confluenceConnector,
  validateConnectorManifest,
  type ConnectorInvocation,
  type ResolvedDataSource,
} from '../src/connectors/index'

const source: ResolvedDataSource = {
  id: 'src_confluence',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'confluence',
  label: 'Acme Confluence',
  consistencyModel: 'authoritative',
  scopes: [
    'read:confluence-content.all',
    'read:confluence-space.summary',
    'write:confluence-content',
    'search:confluence',
  ],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'token_xyz' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('confluence adapter manifest', () => {
  it('classifies as a doc connector', () => {
    expect(confluenceConnector.manifest.kind).toBe('confluence')
    expect(confluenceConnector.manifest.displayName).toBe('Confluence')
    expect(confluenceConnector.manifest.category).toBe('doc')
    expect(confluenceConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares Atlassian 3LO OAuth2 endpoints, env names, and the documented scope set', () => {
    const auth = confluenceConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://auth.atlassian.com/authorize')
    expect(auth.tokenUrl).toBe('https://auth.atlassian.com/oauth/token')
    expect(auth.clientIdEnv).toBe('ATLASSIAN_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('ATLASSIAN_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual([
      'offline_access',
      'read:confluence-content.all',
      'read:confluence-content.summary',
      'read:confluence-space.summary',
      'write:confluence-content',
      'search:confluence',
    ])
  })

  it('passes the shared manifest validator', () => {
    const result = validateConnectorManifest(confluenceConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('exposes pages, spaces, and CQL search capabilities with scope gating', () => {
    const names = confluenceConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'pages.list',
        'pages.get',
        'pages.create',
        'pages.update',
        'pages.delete',
        'spaces.list',
        'spaces.get',
        'search.cql',
      ].sort(),
    )
    const reads = confluenceConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = confluenceConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['pages.get', 'pages.list', 'search.cql', 'spaces.get', 'spaces.list'])
    expect(mutations).toEqual(['pages.create', 'pages.delete', 'pages.update'])

    const pagesCreate = confluenceConnector.manifest.capabilities.find((c) => c.name === 'pages.create')!
    expect(pagesCreate.requiredScopes).toEqual(['write:confluence-content'])
    const searchCql = confluenceConnector.manifest.capabilities.find((c) => c.name === 'search.cql')!
    expect(searchCql.requiredScopes).toEqual(['search:confluence'])
    const spacesList = confluenceConnector.manifest.capabilities.find((c) => c.name === 'spaces.list')!
    expect(spacesList.requiredScopes).toEqual(['read:confluence-space.summary'])
  })
})

describe('confluence adapter execution', () => {
  it('routes pages.get through the api.atlassian.com gateway with the cloudId in the path', async () => {
    const fetchMock = mockFetch({ id: 'page_1', title: 'Hello' })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'pages.get',
      args: { cloudId: 'cloud_abc', pageId: 'page_1', bodyFormat: 'storage' },
      idempotencyKey: 'idem_1',
    }
    const result = await confluenceConnector.executeRead!(invocation)

    expect(result.data).toEqual({ id: 'page_1', title: 'Hello' })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('https://api.atlassian.com/ex/confluence/cloud_abc/wiki/api/v2/pages/page_1')
    expect(String(url)).toContain('body-format=storage')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token_xyz')
    expect(init.method).toBe('GET')
  })

  it('forwards the v2 page envelope unchanged so optional fields like parentId can be omitted', async () => {
    const fetchMock = mockFetch({ id: 'page_new', title: 'Created' }, { status: 200 })
    const page = {
      spaceId: 'space_1',
      title: 'New Page',
      status: 'current',
      body: { representation: 'storage', value: '<p>hello</p>' },
    }
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'pages.create',
      args: { cloudId: 'cloud_abc', page },
      idempotencyKey: 'idem_2',
    }

    const result = await confluenceConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.atlassian.com/ex/confluence/cloud_abc/wiki/api/v2/pages')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual(page)
    expect(body.parentId).toBeUndefined()
  })

  it('throws CredentialsExpired when Atlassian rejects the access token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('expired', { status: 401 })),
    )
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'pages.get',
      args: { cloudId: 'cloud_abc', pageId: 'page_1' },
      idempotencyKey: 'idem_3',
    }
    await expect(confluenceConnector.executeRead!(invocation)).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...init.headers },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
