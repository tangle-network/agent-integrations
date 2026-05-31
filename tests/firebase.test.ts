import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConnectorAdapterProvider,
  firebaseConnector,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '../src/index'

const connection: IntegrationConnection = {
  id: 'conn_firebase_1',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'firebase',
  status: 'active',
  grantedScopes: ['https://www.googleapis.com/auth/datastore'],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

function sourceFor(conn: IntegrationConnection): ResolvedDataSource {
  return {
    id: `source_${conn.connectorId}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind: conn.connectorId,
    label: conn.connectorId,
    consistencyModel: 'authoritative',
    scopes: ['https://www.googleapis.com/auth/datastore'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'ya29.token_123' },
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('firebase connector', () => {
  it('exposes Firestore document CRUD + query under the database category with Google OAuth2', () => {
    expect(firebaseConnector.manifest.kind).toBe('firebase')
    expect(firebaseConnector.manifest.category).toBe('database')

    const auth = firebaseConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(auth.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/datastore')
    expect(auth.clientIdEnv).toBe('FIREBASE_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('FIREBASE_OAUTH_CLIENT_SECRET')
    expect(auth.extraAuthParams?.access_type).toBe('offline')

    const names = firebaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'documents.create',
      'documents.delete',
      'documents.get',
      'documents.list',
      'documents.patch',
      'documents.runQuery',
    ])

    const patch = firebaseConnector.manifest.capabilities.find((c) => c.name === 'documents.patch')!
    expect(patch.class).toBe('mutation')
    if (patch.class === 'mutation') {
      expect(patch.cas).toBe('etag-if-match')
    }
  })

  it('registers firebase under the connector-adapter provider with executable actions', async () => {
    const provider = createConnectorAdapterProvider({
      adapters: [firebaseConnector],
      resolveDataSource: sourceFor,
    })
    const connectors = await provider.listConnectors()
    expect(connectors.map((c) => c.id)).toEqual(['firebase'])
    const fb = connectors[0]!
    expect(fb.auth).toBe('oauth2')
    expect(fb.actions.length).toBeGreaterThanOrEqual(6)
  })

  it('issues a Firestore GET with Bearer credentials and the (default) database segment', async () => {
    const fetchMock = mockFetch({ documents: [{ name: 'projects/p/databases/(default)/documents/users/a' }] })
    const provider = createConnectorAdapterProvider({
      adapters: [firebaseConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'documents.list',
      input: { projectId: 'demo-app', collectionPath: 'users', pageSize: 25 },
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    const urlStr = String(url)
    expect(urlStr).toContain('https://firestore.googleapis.com/v1/projects/demo-app/databases/')
    expect(urlStr).toContain('/documents/users')
    expect(urlStr).toContain('pageSize=25')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer ya29.token_123' })
    expect((init as RequestInit).method).toBe('GET')
  })

  it('sends a Firestore PATCH with the fields envelope as the body', async () => {
    const fetchMock = mockFetch({ name: 'projects/p/databases/(default)/documents/users/a' })
    const provider = createConnectorAdapterProvider({
      adapters: [firebaseConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'documents.patch',
      input: {
        projectId: 'demo-app',
        documentPath: 'users/abc',
        fields: { name: { stringValue: 'Ada' } },
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect((init as RequestInit).method).toBe('PATCH')
    expect(String(url)).toContain('/documents/users%2Fabc')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toEqual({ fields: { name: { stringValue: 'Ada' } } })
  })
})
