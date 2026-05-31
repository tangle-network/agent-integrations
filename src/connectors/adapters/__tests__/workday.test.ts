import { afterEach, describe, expect, it, vi } from 'vitest'
import { workdayConnector } from '../workday.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_workday',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'workday',
  label: 'Workday (Acme)',
  consistencyModel: 'authoritative',
  scopes: ['Staffing', 'Organizations and Roles', 'Time Off and Leave'],
  // Tenant-scoped REST origin. The platform resolves the host + tenant at
  // connection time and persists the full URL — capability paths stay
  // relative below the /ccx/api/v1/{tenant} prefix.
  metadata: { apiBaseUrl: 'https://wd5.workday.com/ccx/api/v1/acme' },
  credentials: { kind: 'oauth2', accessToken: 'token_workday' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workday adapter manifest', () => {
  it('declares the documented tenant-scoped OAuth2 URLs, functional-area scopes, and env-var names', () => {
    const auth = workdayConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 manifest')
    expect(auth.authorizationUrl).toBe('https://{host}/ccx/oauth2/{tenant}/authorize')
    expect(auth.tokenUrl).toBe('https://{host}/ccx/oauth2/{tenant}/token')
    expect(auth.scopes).toEqual([
      'Staffing',
      'Organizations and Roles',
      'Time Off and Leave',
    ])
    expect(auth.clientIdEnv).toBe('WORKDAY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('WORKDAY_OAUTH_CLIENT_SECRET')
  })

  it('exposes the HR action pack (workers, organizations, locations, time off) split between reads and mutations', () => {
    const names = workdayConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'workers.list',
        'workers.get',
        'workers.history',
        'workers.directReports',
        'organizations.list',
        'organizations.get',
        'locations.list',
        'timeOff.types.list',
        'timeOff.entries.list',
        'timeOff.submit',
      ].sort(),
    )
    const reads = workdayConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = workdayConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['timeOff.submit'])
    expect(reads).toEqual(
      [
        'workers.list',
        'workers.get',
        'workers.history',
        'workers.directReports',
        'organizations.list',
        'organizations.get',
        'locations.list',
        'timeOff.types.list',
        'timeOff.entries.list',
      ].sort(),
    )
  })

  it('classifies itself as other (HR) with authoritative consistency', () => {
    expect(workdayConnector.manifest.kind).toBe('workday')
    expect(workdayConnector.manifest.category).toBe('other')
    expect(workdayConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('tags every capability with at least one functional-area scope', () => {
    for (const cap of workdayConnector.manifest.capabilities) {
      expect(cap.requiredScopes && cap.requiredScopes.length).toBeGreaterThan(0)
    }
  })
})

describe('workday adapter execution', () => {
  it('targets the tenant-scoped REST origin with bearer auth and interpolates pagination filters', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: 'w-1', name: 'Ada Lovelace' }], total: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'workers.list',
      args: { limit: 25, offset: 0, search: 'ada' },
      idempotencyKey: 'idem_1',
    }
    const result = await workdayConnector.executeRead!(invocation)

    expect(result.data).toEqual({ data: [{ id: 'w-1', name: 'Ada Lovelace' }], total: 1 })
    const call = fetchMock.mock.calls[0]!
    const url = String(call[0])
    expect(url.startsWith('https://wd5.workday.com/ccx/api/v1/acme/workers')).toBe(true)
    expect(url).toContain('limit=25')
    expect(url).toContain('offset=0')
    expect(url).toContain('search=ada')
    const headers = call[1]!.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token_workday')
  })

  it('interpolates path params for workers.get without dropping the tenant-scoped prefix', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'w-42', name: 'Grace Hopper' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'workers.get',
      args: { workerId: 'w-42' },
      idempotencyKey: 'idem_2',
    }
    await workdayConnector.executeRead!(invocation)

    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe('https://wd5.workday.com/ccx/api/v1/acme/workers/w-42')
    expect(call[1]!.method).toBe('GET')
  })

  it('commits POST mutations against the tenant-scoped requestTimeOff path with the Workday body shape', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'req-1', status: 'Submitted' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const entries = [
      { date: '2026-06-01', dailyQuantity: '8', timeOffType: { id: 'PTO' } },
      { date: '2026-06-02', dailyQuantity: '8', timeOffType: { id: 'PTO' } },
    ]
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'timeOff.submit',
      args: { workerId: 'w-42', entries, comment: 'team offsite' },
      idempotencyKey: 'idem_3',
    }
    const result = await workdayConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe('https://wd5.workday.com/ccx/api/v1/acme/workers/w-42/requestTimeOff')
    expect(call[1]!.method).toBe('POST')
    expect(JSON.parse(String(call[1]!.body))).toEqual({ entries, comment: 'team offsite' })
    const headers = call[1]!.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token_workday')
    expect(headers['content-type']).toBe('application/json')
  })

  it('throws CredentialsExpired when Workday rejects the token with 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'workers.get',
      args: { workerId: 'w-1' },
      idempotencyKey: 'idem_4',
    }
    await expect(workdayConnector.executeRead!(invocation)).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('fails fast when metadata.apiBaseUrl is missing (cannot resolve tenant-scoped base URL)', async () => {
    const noBaseSource: ResolvedDataSource = { ...source, metadata: {} }
    const invocation: ConnectorInvocation = {
      source: noBaseSource,
      capabilityName: 'workers.get',
      args: { workerId: 'w-1' },
      idempotencyKey: 'idem_5',
    }
    await expect(workdayConnector.executeRead!(invocation)).rejects.toThrow(/apiBaseUrl/)
  })
})
