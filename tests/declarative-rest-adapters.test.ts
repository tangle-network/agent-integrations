import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  airtableConnector,
  asanaConnector,
  createConnectorAdapterProvider,
  declarativeRestConnector,
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

  it('form-encodes flat scalar bodies and omits nullish fields', async () => {
    const fetchMock = mockFetch({ ok: true })

    await formConnector.executeMutation!({
      source: sourceFor({ ...connection, connectorId: 'form-test' }),
      capabilityName: 'records.create',
      args: {
        name: 'Ada Lovelace',
        active: true,
        count: 2,
        omitted: null,
      },
      idempotencyKey: 'form-1',
    })

    const [, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(new Headers(init.headers).get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      name: 'Ada Lovelace',
      active: 'true',
      count: '2',
    })
  })

  it('rejects nested form fields before provider traffic', async () => {
    const fetchMock = mockFetch({ ok: true })

    await expect(formConnector.executeMutation!({
      source: sourceFor({ ...connection, connectorId: 'form-test' }),
      capabilityName: 'records.create',
      args: { nested: { unsafe: true } },
      idempotencyKey: 'form-2',
    })).rejects.toThrow('form field nested must be a scalar value')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['.', '..'])('refuses a %s path argument before provider traffic', async (id) => {
    const fetchMock = mockFetch({ ok: true })
    await expect(pathConnector.executeMutation!({
      source: sourceFor({ ...connection, connectorId: 'path-test' }),
      capabilityName: 'records.delete',
      args: { id },
      idempotencyKey: 'path-1',
    })).rejects.toThrow('invalid path argument: dot segment')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a dot segment the template itself declares', async () => {
    const fetchMock = mockFetch({ ok: true })
    await pathConnector.executeMutation!({
      source: sourceFor({ ...connection, connectorId: 'path-test' }),
      capabilityName: 'records.purge',
      args: { id: 'r1' },
      idempotencyKey: 'path-3',
    })
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://path.example.test/purge/r1')
  })

  it('keeps a dotted path argument inside its own segment', async () => {
    const fetchMock = mockFetch({ ok: true })
    await pathConnector.executeMutation!({
      source: sourceFor({ ...connection, connectorId: 'path-test' }),
      capabilityName: 'records.delete',
      args: { id: '../admin' },
      idempotencyKey: 'path-2',
    })
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://path.example.test/v1/records/..%2Fadmin')
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

const formConnector = declarativeRestConnector({
  kind: 'form-test',
  displayName: 'Form Test',
  description: 'Exercises form request serialization.',
  auth: { kind: 'api-key', hint: 'Test token.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://form.example.test',
  capabilities: [{
    name: 'records.create',
    class: 'mutation',
    description: 'Create a record.',
    parameters: { type: 'object', properties: {} },
    request: {
      method: 'POST',
      path: '/records',
      body: 'args',
      bodyEncoding: 'form',
    },
    cas: 'none',
    externalEffect: true,
  }],
})

const pathConnector = declarativeRestConnector({
  kind: 'path-test',
  displayName: 'Path Test',
  description: 'Exercises path argument interpolation.',
  auth: { kind: 'api-key', hint: 'Test token.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://path.example.test/v1',
  capabilities: [{
    name: 'records.delete',
    class: 'mutation',
    description: 'Delete a record.',
    parameters: { type: 'object', properties: { id: { type: 'string' } } },
    request: { method: 'DELETE', path: '/records/{id}' },
    cas: 'none',
    externalEffect: true,
  }, {
    name: 'records.purge',
    class: 'mutation',
    description: 'Purge a record outside the versioned prefix.',
    parameters: { type: 'object', properties: { id: { type: 'string' } } },
    request: { method: 'DELETE', path: '/../purge/{id}' },
    cas: 'none',
    externalEffect: true,
  }],
})

// Every declarative adapter shares this transport, so these cases stand in for
// the per-adapter copies that each re-asserted the same mapping.
describe('declarative REST shared transport', () => {
  const source = sourceFor({ ...connection, connectorId: 'github' })

  it.each([401, 403])('maps HTTP %i to CredentialsExpired', async (status) => {
    mockFetch({ message: 'bad credentials' }, { status })
    await expect(githubConnector.executeRead!({
      source,
      capabilityName: 'issues.search',
      args: { q: 'is:open' },
      idempotencyKey: `expired_${status}`,
    })).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects capabilities the manifest does not declare', async () => {
    const fetchMock = mockFetch({})
    await expect(githubConnector.executeRead!({
      source,
      capabilityName: 'does.not.exist',
      args: {},
      idempotencyKey: 'unknown_1',
    })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
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
