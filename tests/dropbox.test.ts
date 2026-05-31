import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConnectorAdapterProvider,
  dropboxConnector,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '../src/index'

const connection: IntegrationConnection = {
  id: 'conn_dropbox',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'dropbox',
  status: 'active',
  grantedScopes: ['account_info.read', 'files.metadata.read', 'sharing.read'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dropbox declarative adapter', () => {
  it('exposes the documented OAuth2 manifest shape', () => {
    expect(dropboxConnector.manifest.kind).toBe('dropbox')
    expect(dropboxConnector.manifest.category).toBe('storage')
    expect(dropboxConnector.manifest.auth.kind).toBe('oauth2')
    if (dropboxConnector.manifest.auth.kind !== 'oauth2') {
      throw new Error('expected oauth2 auth')
    }
    const auth = dropboxConnector.manifest.auth
    expect(auth.authorizationUrl).toBe('https://www.dropbox.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://api.dropboxapi.com/oauth2/token')
    expect(auth.scopes).toEqual(
      expect.arrayContaining(['account_info.read', 'files.metadata.read', 'sharing.read']),
    )
    expect(auth.clientIdEnv).toBe('DROPBOX_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('DROPBOX_OAUTH_CLIENT_SECRET')
  })

  it('declares the canonical storage action surface', () => {
    const names = dropboxConnector.manifest.capabilities.map((cap) => cap.name).sort()
    expect(names).toEqual([
      'files.copy_v2',
      'files.create_folder_v2',
      'files.delete_v2',
      'files.get_metadata',
      'files.list_folder',
      'files.list_folder_continue',
      'files.move_v2',
      'files.search',
      'sharing.create_shared_link_with_settings',
      'sharing.list_shared_links',
      'users.get_current_account',
      'users.get_space_usage',
    ])
  })

  it('marks every mutation with cas + externalEffect and requires write scope', () => {
    const mutations = dropboxConnector.manifest.capabilities.filter((cap) => cap.class === 'mutation')
    expect(mutations.length).toBeGreaterThanOrEqual(5)
    for (const cap of mutations) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.externalEffect).toBe(true)
      expect(['native-idempotency', 'etag-if-match', 'optimistic-read-verify', 'none']).toContain(cap.cas)
      const scopes = cap.requiredScopes ?? []
      const writeScope = scopes.some(
        (scope) => scope === 'files.metadata.write' || scope === 'sharing.write',
      )
      expect(writeScope).toBe(true)
    }
  })

  it('issues a files.list_folder POST against api.dropboxapi.com with bearer auth and JSON body', async () => {
    const fetchMock = mockFetch({ entries: [], cursor: 'cur1', has_more: false })
    const provider = createConnectorAdapterProvider({
      adapters: [dropboxConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'files.list_folder',
      input: { path: '/Reports', recursive: true, limit: 100 },
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.dropboxapi.com/2/files/list_folder')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer dropbox_access_token',
      'content-type': 'application/json',
    })
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body.path).toBe('/Reports')
    expect(body.recursive).toBe(true)
    expect(body.limit).toBe(100)
  })

  it('preserves the args body verbatim on create_folder_v2', async () => {
    const fetchMock = mockFetch(
      { metadata: { '.tag': 'folder', id: 'id:abc', name: 'Q1', path_lower: '/reports/q1' } },
      { status: 200 },
    )
    const provider = createConnectorAdapterProvider({
      adapters: [dropboxConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'files.create_folder_v2',
      input: { path: '/Reports/Q1', autorename: false },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.dropboxapi.com/2/files/create_folder_v2')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      path: '/Reports/Q1',
      autorename: false,
    })
  })
})

function sourceFor(conn: IntegrationConnection): ResolvedDataSource {
  return {
    id: `source_${conn.connectorId}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind: conn.connectorId,
    label: conn.connectorId,
    consistencyModel: 'authoritative',
    scopes: [
      'account_info.read',
      'files.metadata.read',
      'files.metadata.write',
      'sharing.read',
      'sharing.write',
    ],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'dropbox_access_token' },
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
