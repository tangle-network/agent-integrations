import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  boxConnector,
  createConnectorAdapterProvider,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '../src/index'

const connection: IntegrationConnection = {
  id: 'conn_box',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'box',
  status: 'active',
  grantedScopes: ['root_readonly'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('box declarative adapter', () => {
  it('issues a folder.items GET against api.box.com with bearer auth', async () => {
    const fetchMock = mockFetch({ total_count: 0, entries: [], offset: 0, limit: 100 })
    const provider = createConnectorAdapterProvider({
      adapters: [boxConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'folders.items',
      input: { folderId: '0', limit: 50, sort: 'date', direction: 'DESC' },
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toContain('https://api.box.com/2.0/folders/0/items')
    expect(String(url)).toContain('limit=50')
    expect(String(url)).toContain('sort=date')
    expect(String(url)).toContain('direction=DESC')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer box_access_token' })
  })

  it('preserves the args body verbatim on folder create', async () => {
    const fetchMock = mockFetch({ id: '99', type: 'folder', name: 'Reports' }, { status: 201 })
    const provider = createConnectorAdapterProvider({
      adapters: [boxConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'folders.create',
      input: { name: 'Reports', parent: { id: '0' } },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.box.com/2.0/folders')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      name: 'Reports',
      parent: { id: '0' },
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
    scopes: ['root_readonly', 'root_readwrite'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'box_access_token' },
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
