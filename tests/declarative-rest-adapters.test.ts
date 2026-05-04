import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  airtableConnector,
  asanaConnector,
  createConnectorAdapterProvider,
  githubConnector,
  gitlabConnector,
  salesforceConnector,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '../src/index'

const connection: IntegrationConnection = {
  id: 'conn_1',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'github',
  status: 'active',
  grantedScopes: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('declarative REST adapters', () => {
  it('registers high-leverage executable adapters behind the first-party provider', async () => {
    const provider = createConnectorAdapterProvider({
      adapters: [githubConnector, gitlabConnector, airtableConnector, asanaConnector, salesforceConnector],
      resolveDataSource: sourceFor,
    })

    const connectors = await provider.listConnectors()
    expect(connectors.map((connector) => connector.id)).toEqual([
      'github',
      'gitlab',
      'airtable',
      'asana',
      'salesforce',
    ])
    expect(connectors.flatMap((connector) => connector.actions).length).toBeGreaterThanOrEqual(20)
    expect(connectors.find((connector) => connector.id === 'salesforce')?.auth).toBe('oauth2')
  })

  it('executes a GitHub read with bearer auth and query interpolation', async () => {
    const fetchMock = mockFetch({ items: [{ id: 1, title: 'Bug' }] })
    const provider = createConnectorAdapterProvider({
      adapters: [githubConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'issues.search',
      input: { q: 'repo:tangle-network/agent-builder is:open bug', per_page: 5 },
    })

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ items: [{ id: 1, title: 'Bug' }] })
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toContain('/search/issues?')
    expect(String(url)).toContain('per_page=5')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer token_123' })
  })

  it('preserves object bodies for Airtable and Salesforce mutations', async () => {
    const fetchMock = mockFetch({ id: 'rec_1' }, { status: 201 })
    const airtable = createConnectorAdapterProvider({
      adapters: [airtableConnector],
      resolveDataSource: (conn) => sourceFor({ ...conn, connectorId: 'airtable' }),
    })

    await airtable.invokeAction({ ...connection, connectorId: 'airtable' }, {
      connectionId: connection.id,
      action: 'records.create',
      input: { baseId: 'app_1', tableName: 'Customers', fields: { Name: 'Ada', Status: 'Active' } },
    })

    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({
      fields: { Name: 'Ada', Status: 'Active' },
    })

    fetchMock.mockClear()
    const sfFetchMock = mockFetch({ id: '001' }, { status: 201 })
    const salesforce = createConnectorAdapterProvider({
      adapters: [salesforceConnector],
      resolveDataSource: (conn) => sourceFor({ ...conn, connectorId: 'salesforce' }),
    })

    await salesforce.invokeAction({ ...connection, connectorId: 'salesforce' }, {
      connectionId: connection.id,
      action: 'records.create',
      input: { objectName: 'Account', fields: { Name: 'Tangle' } },
    })

    expect(JSON.parse(String((sfFetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ Name: 'Tangle' })
  })

  it('uses provider-specific credential placement for GitLab', async () => {
    const fetchMock = mockFetch([{ id: 1 }])
    const provider = createConnectorAdapterProvider({
      adapters: [gitlabConnector],
      resolveDataSource: (conn) => sourceFor({ ...conn, connectorId: 'gitlab' }),
    })

    await provider.invokeAction({ ...connection, connectorId: 'gitlab' }, {
      connectionId: connection.id,
      action: 'projects.search',
      input: { search: 'agent' },
    })

    const [_url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect((init as RequestInit).headers).toMatchObject({ 'PRIVATE-TOKEN': 'token_123' })
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
    scopes: [],
    metadata: conn.connectorId === 'salesforce' ? { instanceUrl: 'https://example.my.salesforce.com' } : {},
    credentials: conn.connectorId === 'salesforce'
      ? { kind: 'oauth2', accessToken: 'token_123' }
      : { kind: 'api-key', apiKey: 'token_123' },
    status: 'active',
  }
}

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
