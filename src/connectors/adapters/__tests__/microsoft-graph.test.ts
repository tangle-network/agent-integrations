import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  microsoftGraph,
  validateConnectorManifest,
  type ResolvedDataSource,
} from '../../index.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_graph_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'microsoft-graph',
    label: 'Acme Tenant Directory',
    consistencyModel: 'authoritative',
    scopes: [
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/User.Read.All',
      'https://graph.microsoft.com/Group.Read.All',
      'https://graph.microsoft.com/Organization.Read.All',
    ],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('microsoft-graph adapter', () => {
  const adapter = microsoftGraph({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest passes the connector validator', () => {
    expect(validateConnectorManifest(adapter.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('manifest exposes the documented identity / directory capability set', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'get_me',
      'get_organization',
      'list_group_members',
      'list_groups',
      'list_users',
      'lookup_user',
    ])
  })

  it('declares oauth2 auth with v2.0 endpoints and the documented env-var names', () => {
    expect(adapter.manifest.auth).toMatchObject({
      kind: 'oauth2',
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      clientIdEnv: 'MS_OAUTH_CLIENT_ID',
      clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
    })
    if (adapter.manifest.auth.kind === 'oauth2') {
      expect(adapter.manifest.auth.scopes).toContain('offline_access')
      expect(adapter.manifest.auth.scopes).toContain('https://graph.microsoft.com/User.Read.All')
      expect(adapter.manifest.auth.scopes).toContain('https://graph.microsoft.com/Group.Read.All')
    }
  })

  it('declares no mutation surface (directory is read-only)', () => {
    expect(adapter.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(adapter.executeMutation).toBeUndefined()
    for (const cap of adapter.manifest.capabilities) {
      expect(cap.class).toBe('read')
    }
  })

  it('exposes a read handler but no mutation handler', () => {
    expect(typeof adapter.executeRead).toBe('function')
    expect(adapter.executeMutation).toBeUndefined()
  })

  it('get_me selects the identity fields from /me', async () => {
    let calledUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input)
      return jsonResponse({
        id: 'u1',
        displayName: 'Alice Smith',
        mail: 'alice@acme.com',
        userPrincipalName: 'alice@acme.com',
        jobTitle: 'Engineer',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'get_me',
      args: {},
      idempotencyKey: 'k1',
    })
    expect(calledUrl).toBe(
      'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,jobTitle',
    )
    const data = result.data as { user: { id: string; displayName: string } }
    expect(data.user).toMatchObject({ id: 'u1', displayName: 'Alice Smith', mail: 'alice@acme.com' })
  })

  it('lookup_user OData $filter escapes single quotes and reports not-found cleanly', async () => {
    let observedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      observedUrl = String(input)
      return jsonResponse({ value: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'lookup_user',
      args: { email: "o'malley@acme.com" },
      idempotencyKey: 'k1',
    })

    expect((result.data as { found: boolean }).found).toBe(false)
    // OData escapes single quote by doubling it.
    expect(decodeURIComponent(observedUrl)).toContain("mail eq 'o''malley@acme.com'")
    expect(decodeURIComponent(observedUrl)).toContain("userPrincipalName eq 'o''malley@acme.com'")
  })

  it('list_users issues the ConsistencyLevel: eventual header when $search is supplied', async () => {
    let observedHeaders: Headers | undefined
    let observedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedHeaders = new Headers(init?.headers)
      return jsonResponse({
        value: [
          { id: 'u1', displayName: 'Alice', mail: 'alice@acme.com', userPrincipalName: 'alice@acme.com' },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_users',
      args: { search: 'ali', top: 10 },
      idempotencyKey: 'k1',
    })

    expect(observedHeaders?.get('ConsistencyLevel') ?? observedHeaders?.get('consistencylevel')).toBe(
      'eventual',
    )
    expect(observedUrl).toContain('$top=10')
    expect(observedUrl).toContain('$search=')
    const data = result.data as { users: Array<{ id: string }> }
    expect(data.users).toHaveLength(1)
    expect(data.users[0]).toMatchObject({ id: 'u1', displayName: 'Alice' })
  })

  it('list_group_members surfaces the odata.type as the bare suffix', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        value: [
          {
            '@odata.type': '#microsoft.graph.user',
            id: 'u1',
            displayName: 'Alice',
            mail: 'alice@acme.com',
          },
          {
            '@odata.type': '#microsoft.graph.group',
            id: 'g2',
            displayName: 'Nested Team',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_group_members',
      args: { groupId: 'group-1' },
      idempotencyKey: 'k1',
    })
    const data = result.data as { members: Array<{ type: string; id: string }> }
    expect(data.members).toHaveLength(2)
    expect(data.members[0]).toMatchObject({ type: 'user', id: 'u1' })
    expect(data.members[1]).toMatchObject({ type: 'group', id: 'g2' })
  })

  it('get_organization returns the first tenant record with verifiedDomains projected', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        value: [
          {
            id: 'tenant-1',
            displayName: 'Acme Inc.',
            tenantType: 'AAD',
            verifiedDomains: [
              { name: 'acme.com', isDefault: true },
              { name: 'acme.onmicrosoft.com', isDefault: false },
            ],
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'get_organization',
      args: {},
      idempotencyKey: 'k1',
    })
    const data = result.data as {
      organization: { id: string; displayName: string; verifiedDomains: Array<{ name: string }> }
    }
    expect(data.organization.id).toBe('tenant-1')
    expect(data.organization.verifiedDomains).toHaveLength(2)
    expect(data.organization.verifiedDomains[0]).toMatchObject({ name: 'acme.com', isDefault: true })
  })

  it('maps a 401 from Graph into CredentialsExpired', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'get_me',
        args: {},
        idempotencyKey: 'k1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('test() returns ok when Graph /me responds 200', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'u1' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await adapter.test(source())
    expect(out).toEqual({ ok: true })
  })

  it('test() reports a reconnect reason when Graph rejects the token', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await adapter.test(source())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/reconnect required/i)
  })

  it('refuses to refresh without a refresh token', async () => {
    await expect(
      adapter.refreshToken!({ kind: 'oauth2', accessToken: 'at' }),
    ).rejects.toThrow(/missing refresh token/)
  })
})
