import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  oneloginConnector,
  pingIdentityConnector,
  scimConnector,
} from '../src/connectors/adapters/index.js'
import type { ConnectorCredentials, ResolvedDataSource } from '../src/connectors/types.js'

function source(
  kind: string,
  metadata: Record<string, unknown>,
  credentials: ConnectorCredentials,
): ResolvedDataSource {
  return {
    id: `source_${kind}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata,
    credentials,
    status: 'active',
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('identity provisioning manifests', () => {
  it.each([
    ['ping-identity', pingIdentityConnector],
    ['onelogin', oneloginConnector],
    ['scim', scimConnector],
  ])('ships a deep executable %s user and group surface', (kind, connector) => {
    expect(connector.manifest).toMatchObject({
      kind,
      auth: { kind: 'api-key' },
      category: 'other',
      defaultConsistencyModel: 'authoritative',
    })
    const capabilities = connector.manifest.capabilities
    const expected = [
      'users.list',
      'users.get',
      'users.create',
      'users.update',
      'users.deactivate',
      'groups.list',
      'groups.get',
      'groups.users.add',
      'groups.users.remove',
    ]
    if (kind !== 'onelogin') expected.push('groups.create', 'groups.update')
    expect(capabilities.map((capability) => capability.name)).toEqual(expect.arrayContaining(expected))
    for (const capability of capabilities.filter((candidate) => candidate.class === 'mutation')) {
      expect(capability.externalEffect, capability.name).toBe(true)
    }
  })
})

describe('PingOne client credentials and tenant isolation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exchanges once at the environment-scoped EU endpoint and caches the short-lived token', async () => {
    const requests: Array<{ url: string; authorization: string | null; body?: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = {
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
        body: typeof init?.body === 'string' ? init.body : undefined,
      }
      requests.push(request)
      if (request.url.includes('/as/token')) return json({ access_token: 'ping-access', expires_in: 3600 })
      return json({ _embedded: { users: [] } })
    }))

    const pingSource = source(
      'ping-identity',
      { environmentId: 'env-eu-1', region: 'eu' },
      { kind: 'custom', values: { clientId: 'client:id', clientSecret: 's+e%cret' } },
    )
    await Promise.all([
      pingIdentityConnector.executeRead!({
        source: pingSource,
        capabilityName: 'users.list',
        args: { limit: 20 },
        idempotencyKey: 'read-1',
      }),
      pingIdentityConnector.executeRead!({
        source: pingSource,
        capabilityName: 'groups.list',
        args: { limit: 20, connection: { environmentId: 'attacker-environment' } },
        idempotencyKey: 'read-2',
      }),
    ])

    const tokenRequests = requests.filter((request) => request.url.includes('/as/token'))
    expect(tokenRequests).toHaveLength(1)
    expect(tokenRequests[0]).toEqual({
      url: 'https://auth.pingone.eu/env-eu-1/as/token',
      authorization: `Basic ${Buffer.from(
        'client%3Aid:s%2Be%25cret',
      ).toString('base64')}`,
      body: 'grant_type=client_credentials',
    })
    expect(requests.filter((request) => request.url.startsWith('https://api.pingone.eu'))).toHaveLength(2)
    expect(requests.every((request) => !request.url.includes('attacker-environment'))).toBe(true)
    expect(requests.slice(1).every((request) => request.authorization === 'Bearer ping-access')).toBe(true)
  })

  it('rejects unknown regions and missing environment ids before credentials leave the process', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const credentials = { kind: 'custom', values: { clientId: 'client', clientSecret: 'secret' } } as const

    await expect(pingIdentityConnector.executeRead!({
      source: source('ping-identity', { environmentId: 'env', region: 'attacker' }, credentials),
      capabilityName: 'users.list',
      args: {},
      idempotencyKey: 'read-3',
    })).rejects.toThrow('unsupported region')
    await expect(pingIdentityConnector.test(
      source('ping-identity', { region: 'us' }, credentials),
    )).resolves.toEqual({ ok: false, reason: 'missing metadata.environmentId' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not surface rejected client ids or secrets from token failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'ping-client and ping-secret were rejected',
      { status: 401 },
    )))
    const result = await pingIdentityConnector.test(source(
      'ping-identity',
      { environmentId: 'env-us-1', region: 'us' },
      { kind: 'api-key', apiKey: JSON.stringify({ clientId: 'ping-client', clientSecret: 'ping-secret' }) },
    ))
    expect(result).toEqual({ ok: false, reason: 'Ping Identity rejected client credentials (401)' })
    expect(JSON.stringify(result)).not.toContain('ping-client')
    expect(JSON.stringify(result)).not.toContain('ping-secret')
  })
})

describe('OneLogin regional client credentials', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('routes an EU user update through the EU token and API endpoints', async () => {
    const requests: Array<{ url: string; method?: string; authorization: string | null; body?: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({
        url,
        method: init?.method,
        authorization: new Headers(init?.headers).get('authorization'),
        body: init?.body && !url.includes('/token') ? JSON.parse(String(init.body)) : init?.body,
      })
      if (url.includes('/token')) return json({ access_token: 'onelogin-access', expires_in: 3600 })
      return json({ id: 42, firstname: 'Ada' })
    }))

    const result = await oneloginConnector.executeMutation!({
      source: source(
        'onelogin',
        { region: 'eu' },
        { kind: 'custom', values: { clientId: 'ol-client', clientSecret: 'ol-secret' } },
      ),
      capabilityName: 'users.update',
      args: { userId: '42', user: { firstname: 'Ada' } },
      idempotencyKey: 'write-1',
    })

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.eu.onelogin.com/auth/oauth2/v2/token',
      'https://api.eu.onelogin.com/api/2/users/42',
    ])
    expect(requests[1]).toMatchObject({
      method: 'PUT',
      authorization: 'bearer:onelogin-access',
      body: { firstname: 'Ada' },
    })
    expect(requests[0]).toMatchObject({
      authorization: null,
      body: 'grant_type=client_credentials&client_id=ol-client&client_secret=ol-secret',
    })
    expect(result.status).toBe('committed')
  })

  it('refuses to clear a different OneLogin group assignment', async () => {
    const methods: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      methods.push(`${init?.method} ${new URL(url).pathname}`)
      if (url.includes('/token')) return json({ access_token: 'onelogin-remove-access', expires_in: 3600 })
      return json({ id: 42, group_id: 7 })
    }))
    const result = await oneloginConnector.executeMutation!({
      source: source(
        'onelogin',
        { region: 'us' },
        { kind: 'custom', values: { clientId: 'remove-client', clientSecret: 'remove-secret' } },
      ),
      capabilityName: 'groups.users.remove',
      args: { userId: '42', groupId: '8' },
      idempotencyKey: 'write-conflict',
    })
    expect(result).toMatchObject({ status: 'conflict', currentState: { id: 42, group_id: 7 } })
    expect(methods).toEqual([
      'POST /auth/oauth2/v2/token',
      'GET /api/2/users/42',
    ])
  })
})

describe('generic SCIM security and provisioning', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves the configured SCIM path and emits a standard group membership PatchOp', async () => {
    let request: { url?: string; authorization?: string | null; body?: unknown } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      }
      return json({ id: 'group-1' })
    }))

    await scimConnector.executeMutation!({
      source: source(
        'scim',
        { baseUrl: 'https://identity.customer.example/scim/v2' },
        { kind: 'api-key', apiKey: 'scim-token' },
      ),
      capabilityName: 'groups.users.add',
      args: { groupId: 'group-1', userId: 'user-1' },
      idempotencyKey: 'write-2',
    })

    expect(request).toEqual({
      url: 'https://identity.customer.example/scim/v2/Groups/group-1',
      authorization: 'Bearer scim-token',
      body: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'add', path: 'members', value: [{ value: 'user-1' }] }],
      },
    })
  })

  it('builds a targeted SCIM membership removal without accepting a model-authored filter', async () => {
    let body: unknown
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return json({ id: 'group-1' })
    }))
    await scimConnector.executeMutation!({
      source: source(
        'scim',
        { baseUrl: 'https://identity.customer.example/scim/v2' },
        { kind: 'api-key', apiKey: 'scim-token' },
      ),
      capabilityName: 'groups.users.remove',
      args: { groupId: 'group-1', userId: 'user-1' },
      idempotencyKey: 'write-3',
    })
    expect(body).toEqual({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'remove', path: 'members[value eq "user-1"]' }],
    })
  })

  it.each([
    'http://identity.customer.example/scim/v2',
    'https://localhost/scim/v2',
    'https://127.0.0.1/scim/v2',
    'https://169.254.169.254/latest/meta-data',
  ])('rejects unsafe SCIM endpoint %s before sending the bearer token', async (baseUrl) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(scimConnector.test(source(
      'scim',
      { baseUrl },
      { kind: 'api-key', apiKey: 'scim-token' },
    ))).resolves.toEqual({ ok: false, reason: 'connection base URL must be a public HTTPS endpoint' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports an expired bearer token without echoing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('scim-token is invalid', { status: 401 })))
    const failure = scimConnector.executeRead!({
      source: source(
        'scim',
        { baseUrl: 'https://identity.customer.example/scim/v2' },
        { kind: 'api-key', apiKey: 'scim-token' },
      ),
      capabilityName: 'users.get',
      args: { userId: 'user-1' },
      idempotencyKey: 'read-4',
    })
    await expect(failure).rejects.toMatchObject({ name: 'CredentialsExpired' })
    await expect(failure).rejects.not.toThrow('scim-token')
  })
})
