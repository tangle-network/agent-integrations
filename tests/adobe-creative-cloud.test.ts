import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adobeCreativeCloudConnector,
  createConnectorAdapterProvider,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '../src/index'

const connection: IntegrationConnection = {
  id: 'conn_adobe_cc',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'adobe-creative-cloud',
  status: 'active',
  grantedScopes: [
    'openid',
    'profile',
    'email',
    'offline_access',
    'lr_partner_apis',
    'lr_partner_rendition_apis',
  ],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('adobe creative cloud declarative adapter', () => {
  it('issues a catalogs.list GET against lr.adobe.io with bearer auth', async () => {
    const fetchMock = mockFetch({ resources: [] })
    const provider = createConnectorAdapterProvider({
      adapters: [adobeCreativeCloudConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'catalogs.list',
      input: {},
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://lr.adobe.io/v2/catalogs')
    expect((init as RequestInit).method).toBe('GET')
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer adobe_access_token',
    })
  })

  it('routes ims.userinfo to the absolute Adobe IMS userinfo endpoint', async () => {
    const fetchMock = mockFetch({ sub: 'adobe_id_abc', email: 'creator@example.com' })
    const provider = createConnectorAdapterProvider({
      adapters: [adobeCreativeCloudConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'ims.userinfo',
      input: {},
    })

    expect(result.ok).toBe(true)
    const [url] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://ims-na1.adobelogin.com/ims/userinfo/v2')
  })

  it('PUTs the album payload verbatim on albums.create', async () => {
    const fetchMock = mockFetch(
      {
        id: 'album_uuid_1',
        subtype: 'collection',
        payload: { name: 'Q1 Shoots', parent: null },
      },
      { status: 200 },
    )
    const provider = createConnectorAdapterProvider({
      adapters: [adobeCreativeCloudConnector],
      resolveDataSource: sourceFor,
    })

    const albumPayload = { name: 'Q1 Shoots', parent: null }
    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'albums.create',
      input: {
        catalog_id: 'cat_uuid_1',
        album_id: 'album_uuid_1',
        payload: albumPayload,
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://lr.adobe.io/v2/catalogs/cat_uuid_1/albums/album_uuid_1')
    expect((init as RequestInit).method).toBe('PUT')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual(albumPayload)
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
      'openid',
      'profile',
      'email',
      'offline_access',
      'lr_partner_apis',
      'lr_partner_rendition_apis',
    ],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'adobe_access_token' },
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
