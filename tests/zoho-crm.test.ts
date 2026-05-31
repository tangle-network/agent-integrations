import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  zohoCrmConnector,
  createConnectorAdapterProvider,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '../src/index'

const connection: IntegrationConnection = {
  id: 'conn_zoho',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'zoho-crm',
  status: 'active',
  grantedScopes: ['ZohoCRM.modules.ALL'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('zoho-crm declarative adapter', () => {
  it('exposes the documented OAuth2 manifest shape', () => {
    expect(zohoCrmConnector.manifest.kind).toBe('zoho-crm')
    expect(zohoCrmConnector.manifest.category).toBe('crm')
    expect(zohoCrmConnector.manifest.auth.kind).toBe('oauth2')
    if (zohoCrmConnector.manifest.auth.kind !== 'oauth2') {
      throw new Error('expected oauth2 auth')
    }
    const auth = zohoCrmConnector.manifest.auth
    expect(auth.authorizationUrl).toBe('https://accounts.zoho.com/oauth/v2/auth')
    expect(auth.tokenUrl).toBe('https://accounts.zoho.com/oauth/v2/token')
    expect(auth.scopes).toEqual(
      expect.arrayContaining(['ZohoCRM.modules.ALL', 'ZohoCRM.users.READ', 'offline_access']),
    )
    expect(auth.clientIdEnv).toBe('ZOHO_CRM_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('ZOHO_CRM_OAUTH_CLIENT_SECRET')
  })

  it('declares the canonical CRM action surface for the catalog', () => {
    const names = zohoCrmConnector.manifest.capabilities.map((cap) => cap.name).sort()
    expect(names).toEqual([
      'records.create',
      'records.delete',
      'records.get',
      'records.list',
      'records.search',
      'records.update',
      'records.upsert',
    ])

    const writes = zohoCrmConnector.manifest.capabilities.filter((cap) => cap.class === 'mutation')
    expect(writes.length).toBe(4)
    for (const cap of writes) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.externalEffect).toBe(true)
      expect(['native-idempotency', 'optimistic-read-verify', 'none']).toContain(cap.cas)
    }
  })

  it('issues a list call against the regional api domain with Zoho-oauthtoken auth', async () => {
    const fetchMock = mockFetch({ data: [{ id: '1', Last_Name: 'Smith' }] })
    const provider = createConnectorAdapterProvider({
      adapters: [zohoCrmConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'records.list',
      input: { module: 'Leads', per_page: 25 },
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toContain('https://www.zohoapis.eu/crm/v6/Leads')
    expect(String(url)).toContain('per_page=25')
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Zoho-oauthtoken token_zoho_1',
    })
  })

  it('wraps create mutations into the Zoho data envelope verbatim', async () => {
    const fetchMock = mockFetch(
      { data: [{ code: 'SUCCESS', details: { id: '987' } }] },
      { status: 201 },
    )
    const provider = createConnectorAdapterProvider({
      adapters: [zohoCrmConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'records.create',
      input: {
        module: 'Contacts',
        data: [{ Last_Name: 'Lovelace', Email: 'ada@example.com' }],
        trigger: ['workflow'],
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://www.zohoapis.eu/crm/v6/Contacts')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      data: [{ Last_Name: 'Lovelace', Email: 'ada@example.com' }],
      trigger: ['workflow'],
    })
  })

  it('falls back to the US api domain when metadata.apiDomain is absent', async () => {
    const fetchMock = mockFetch({ data: [] })
    const provider = createConnectorAdapterProvider({
      adapters: [zohoCrmConnector],
      resolveDataSource: () => ({
        ...sourceFor(connection),
        metadata: {},
      }),
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'records.list',
      input: { module: 'Accounts' },
    })

    const [url] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toContain('https://www.zohoapis.com/crm/v6/Accounts')
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
    scopes: ['ZohoCRM.modules.ALL'],
    metadata: { apiDomain: 'https://www.zohoapis.eu' },
    credentials: { kind: 'oauth2', accessToken: 'token_zoho_1' },
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
