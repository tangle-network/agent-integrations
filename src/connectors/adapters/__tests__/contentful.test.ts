import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  contentfulConnector,
  createConnectorAdapterProvider,
  startOAuthFlow,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '../../../index.js'

const connection: IntegrationConnection = {
  id: 'conn_contentful',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'contentful',
  status: 'active',
  grantedScopes: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

function source(): ResolvedDataSource {
  return {
    id: 'source_contentful',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'contentful',
    label: 'contentful',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'token_xyz' },
    status: 'active',
  }
}

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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('contentful adapter manifest', () => {
  it('declares the CMA OAuth surface and required capabilities', () => {
    const m = contentfulConnector.manifest
    expect(m.kind).toBe('contentful')
    expect(m.category).toBe('doc')
    expect(m.defaultConsistencyModel).toBe('authoritative')
    expect(m.auth.kind).toBe('oauth2')
    if (m.auth.kind === 'oauth2') {
      expect(m.auth.authorizationUrl).toBe('https://be.contentful.com/oauth/authorize')
      expect(m.auth.tokenUrl).toBe('https://be.contentful.com/oauth/token')
      expect(m.auth.scopes).toEqual(['content_management_read', 'content_management_manage'])
      expect(m.auth.clientIdEnv).toBe('CONTENTFUL_OAUTH_CLIENT_ID')
      expect(m.auth.clientSecretEnv).toBe('CONTENTFUL_OAUTH_CLIENT_SECRET')
    }
    const names = m.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'entries.create',
      'entries.delete',
      'entries.get',
      'entries.list',
      'entries.publish',
      'entries.unpublish',
      'entries.update',
    ])
    const update = m.capabilities.find((c) => c.name === 'entries.update')
    expect(update?.class).toBe('mutation')
    if (update && update.class === 'mutation') {
      expect(update.cas).toBe('etag-if-match')
      expect(update.externalEffect).toBe(true)
    }
  })
})

describe('contentful startAuth URL construction', () => {
  it('builds an OAuth2 authorize URL via startOAuthFlow with the manifest endpoint and scopes', () => {
    const m = contentfulConnector.manifest
    if (m.auth.kind !== 'oauth2') throw new Error('contentful auth must be oauth2')

    const { authorizationUrl, state } = startOAuthFlow({
      projectId: 'project_1',
      kind: m.kind,
      label: 'Contentful CMS',
      authorizationUrl: m.auth.authorizationUrl,
      scopes: m.auth.scopes,
      clientId: 'cf_client_abc',
      redirectUri: 'https://example.com/oauth/callback',
    })

    const parsed = new URL(authorizationUrl)
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://be.contentful.com/oauth/authorize')
    expect(parsed.searchParams.get('client_id')).toBe('cf_client_abc')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://example.com/oauth/callback')
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('scope')).toBe('content_management_read content_management_manage')
    expect(parsed.searchParams.get('state')).toBe(state)
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('contentful invokeAction', () => {
  it('lists entries with bearer auth and interpolated path + query', async () => {
    const fetchMock = mockFetch({ items: [{ sys: { id: 'e1' } }] })
    const provider = createConnectorAdapterProvider({
      adapters: [contentfulConnector],
      resolveDataSource: () => source(),
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'entries.list',
      input: { spaceId: 'sp_1', environmentId: 'master', contentType: 'post', limit: 25 },
    })

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ items: [{ sys: { id: 'e1' } }] })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    const callUrl = String(url)
    expect(callUrl).toContain('/spaces/sp_1/environments/master/entries')
    expect(callUrl).toContain('content_type=post')
    expect(callUrl).toContain('limit=25')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token_xyz')
  })

  it('sends the X-Contentful-Version header on updates for CAS enforcement', async () => {
    const fetchMock = mockFetch({ sys: { id: 'e1', version: 3 }, fields: {} })
    const provider = createConnectorAdapterProvider({
      adapters: [contentfulConnector],
      resolveDataSource: () => source(),
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'entries.update',
      input: {
        spaceId: 'sp_1',
        environmentId: 'master',
        entryId: 'e1',
        version: 2,
        fields: { title: { 'en-US': 'Hello' } },
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toContain('/spaces/sp_1/environments/master/entries/e1')
    expect(init.method).toBe('PUT')
    const headers = init.headers as Record<string, string>
    expect(headers['x-contentful-version']).toBe('2')
    expect(headers['content-type']).toBe('application/vnd.contentful.management.v1+json')
    expect(JSON.parse(String(init.body))).toEqual({ fields: { title: { 'en-US': 'Hello' } } })
  })
})
