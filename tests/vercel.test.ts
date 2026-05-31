import { afterEach, describe, expect, it, vi } from 'vitest'
import { vercelConnector } from '../src/connectors/adapters/vercel.js'
import { validateConnectorManifest } from '../src/connectors/types.js'
import {
  createConnectorAdapterProvider,
  type IntegrationConnection,
  type ResolvedDataSource,
} from '../src/index.js'

const connection: IntegrationConnection = {
  id: 'conn_vercel',
  owner: { type: 'user', id: 'user_1' },
  providerId: 'first-party',
  connectorId: 'vercel',
  status: 'active',
  grantedScopes: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('vercel adapter manifest', () => {
  it('identifies as vercel with an authoritative consistency model', () => {
    expect(vercelConnector.manifest.kind).toBe('vercel')
    expect(vercelConnector.manifest.category).toBe('other')
    expect(vercelConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the documented Vercel endpoints and env-var names', () => {
    const auth = vercelConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://vercel.com/integrations/install')
    expect(auth.tokenUrl).toBe('https://api.vercel.com/v2/oauth/access_token')
    expect(auth.clientIdEnv).toBe('VERCEL_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('VERCEL_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('project:read')
    expect(auth.scopes).toContain('project:read-write')
    expect(auth.scopes).toContain('deployment:read-write')
    expect(auth.scopes).toContain('env:read-write')
  })

  it('exposes the user / team / project / deployment / env / domain surface', () => {
    const names = vercelConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'user.get',
        'teams.list',
        'projects.list',
        'projects.get',
        'projects.create',
        'projects.delete',
        'deployments.list',
        'deployments.get',
        'deployments.create',
        'deployments.cancel',
        'env.list',
        'env.create',
        'env.delete',
        'domains.list',
        'domains.get',
      ].sort(),
    )
    const reads = vercelConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = vercelConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'deployments.get',
        'deployments.list',
        'domains.get',
        'domains.list',
        'env.list',
        'projects.get',
        'projects.list',
        'teams.list',
        'user.get',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'deployments.cancel',
        'deployments.create',
        'env.create',
        'env.delete',
        'projects.create',
        'projects.delete',
      ].sort(),
    )
  })

  it('marks every mutation as a native-idempotency external effect', () => {
    for (const cap of vercelConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas).toBe('native-idempotency')
        expect(cap.externalEffect).toBe(true)
      }
    }
  })

  it('only requires name for projects.create — git/framework/build fields stay optional', () => {
    const create = vercelConnector.manifest.capabilities.find((c) => c.name === 'projects.create')
    expect(create).toBeDefined()
    const params = create!.parameters as { required?: string[]; properties?: Record<string, unknown> }
    expect(params.required).toEqual(['name'])
    expect(Object.keys(params.properties ?? {})).toEqual(
      expect.arrayContaining([
        'name',
        'framework',
        'gitRepository',
        'publicSource',
        'rootDirectory',
        'buildCommand',
        'installCommand',
        'outputDirectory',
        'devCommand',
        'teamId',
      ]),
    )
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(vercelConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = vercelConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = vercelConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(vercelConnector.executeRead)).toBe(hasReads)
    expect(Boolean(vercelConnector.executeMutation)).toBe(hasMutations)
  })
})

describe('vercel adapter execution', () => {
  it('reads a project by id with bearer auth and optional teamId scope', async () => {
    const fetchMock = mockFetch({ id: 'prj_abc', name: 'demo' })
    const provider = createConnectorAdapterProvider({
      adapters: [vercelConnector],
      resolveDataSource: sourceFor,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'projects.get',
      input: { idOrName: 'prj_abc', teamId: 'team_xyz' },
    })

    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ id: 'prj_abc', name: 'demo' })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.vercel.com/v9/projects/prj_abc?teamId=team_xyz')
    expect((init as RequestInit).method).toBe('GET')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer vercel_test_token')
  })

  it('creates a project — POST /v9/projects with name in the body', async () => {
    const fetchMock = mockFetch({ id: 'prj_new', name: 'new-app' }, { status: 200 })
    const provider = createConnectorAdapterProvider({
      adapters: [vercelConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'projects.create',
      input: { name: 'new-app' },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.vercel.com/v9/projects')
    expect((init as RequestInit).method).toBe('POST')

    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body.name).toBe('new-app')
  })

  it('routes a team-scoped project create with framework + gitRepository', async () => {
    const fetchMock = mockFetch({ id: 'prj_team' }, { status: 200 })
    const provider = createConnectorAdapterProvider({
      adapters: [vercelConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'projects.create',
      input: {
        name: 'team-app',
        framework: 'nextjs',
        gitRepository: { type: 'github', repo: 'acme/team-app' },
        teamId: 'team_acme',
      },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.vercel.com/v9/projects?teamId=team_acme')
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
    expect(body.name).toBe('team-app')
    expect(body.framework).toBe('nextjs')
    expect(body.gitRepository).toEqual({ type: 'github', repo: 'acme/team-app' })
  })

  it('cancels a deployment via PATCH /v12/deployments/{id}/cancel', async () => {
    const fetchMock = mockFetch({ id: 'dpl_123', state: 'CANCELED' })
    const provider = createConnectorAdapterProvider({
      adapters: [vercelConnector],
      resolveDataSource: sourceFor,
    })

    await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'deployments.cancel',
      input: { id: 'dpl_123' },
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.vercel.com/v12/deployments/dpl_123/cancel')
    expect((init as RequestInit).method).toBe('PATCH')
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
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'vercel_test_token' },
    status: 'active',
  }
}

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(
    async (_input: URL | string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json', ...init.headers },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
