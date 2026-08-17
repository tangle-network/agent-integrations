import { afterEach, describe, expect, it, vi } from 'vitest'
import { oktaConnector } from '../src/connectors/adapters/okta.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(domain = 'https://dev-123456.okta.com'): ResolvedDataSource {
  return {
    id: 'source_okta',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'okta',
    label: 'Okta test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { domain },
    credentials: { kind: 'api-key', apiKey: 'okta-token' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Okta admin adapter manifest', () => {
  it('exposes users, lifecycle, groups, membership, and audit reads', () => {
    expect(oktaConnector.manifest).toMatchObject({
      kind: 'okta',
      category: 'other',
      defaultConsistencyModel: 'authoritative',
      auth: { kind: 'api-key' },
    })
    expect(oktaConnector.manifest.capabilities.map((capability) => capability.name).sort()).toEqual([
      'groups.create',
      'groups.list',
      'groups.update',
      'groups.users.add',
      'groups.users.list',
      'groups.users.remove',
      'system.logs.list',
      'users.activate',
      'users.create',
      'users.deactivate',
      'users.find-by-email',
      'users.get',
      'users.list',
      'users.suspend',
      'users.unsuspend',
      'users.update',
    ])
  })

  it('marks every identity or membership write as an approved external effect', () => {
    const mutations = oktaConnector.manifest.capabilities.filter(
      (capability) => capability.class === 'mutation',
    )
    expect(mutations).toHaveLength(10)
    for (const capability of mutations) expect(capability.externalEffect, capability.name).toBe(true)
  })
})

describe('Okta tenant and request isolation', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('validates credentials on the configured tenant with the SSWS token scheme', async () => {
    let request: { url?: string; authorization?: string | null } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
      }
      return jsonResponse([])
    }))

    await expect(oktaConnector.test(source())).resolves.toEqual({ ok: true })
    expect(request).toEqual({
      url: 'https://dev-123456.okta.com/api/v1/users?limit=1',
      authorization: 'SSWS okta-token',
    })
  })

  it('rejects lookalike tenant hosts before sending the API token', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(oktaConnector.test(source('https://dev-123456.okta.com.attacker.test'))).resolves.toEqual({
      ok: false,
      reason: 'connection base URL is not an allowed provider endpoint',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves Okta search expressions as one query value', async () => {
    let url = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      url = String(input)
      return jsonResponse([])
    }))

    await oktaConnector.executeRead!({
      source: source(),
      capabilityName: 'users.list',
      args: { search: 'profile.email eq "ada@example.com"', limit: 25 },
      idempotencyKey: 'read-1',
    })

    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/api/v1/users')
    expect(parsed.searchParams.get('search')).toBe('profile.email eq "ada@example.com"')
    expect(parsed.searchParams.get('limit')).toBe('25')
  })

  it('creates a user with the provider-native profile envelope', async () => {
    let request: { url?: string; method?: string; body?: unknown } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = {
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body)),
      }
      return jsonResponse({ id: 'user_1', status: 'STAGED' }, 201)
    }))

    const result = await oktaConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.create',
      args: {
        activate: false,
        profile: {
          login: 'ada@example.com',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
        },
      },
      idempotencyKey: 'write-1',
    })

    expect(request).toEqual({
      url: 'https://dev-123456.okta.com/api/v1/users?activate=false',
      method: 'POST',
      body: {
        profile: {
          login: 'ada@example.com',
          email: 'ada@example.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
        },
      },
    })
    expect(result.status).toBe('committed')
  })

  it('routes lifecycle and membership mutations without leaking path arguments into a body', async () => {
    const requests: Array<{ url: string; method?: string; body?: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      return new Response(null, { status: 204 })
    }))

    await oktaConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.activate',
      args: { userId: 'user_1', sendEmail: false },
      idempotencyKey: 'write-2',
    })
    await oktaConnector.executeMutation!({
      source: source(),
      capabilityName: 'groups.users.add',
      args: { groupId: 'group_1', userId: 'user_1' },
      idempotencyKey: 'write-3',
    })

    expect(requests).toEqual([
      {
        url: 'https://dev-123456.okta.com/api/v1/users/user_1/lifecycle/activate?sendEmail=false',
        method: 'POST',
        body: {},
      },
      {
        url: 'https://dev-123456.okta.com/api/v1/groups/group_1/users/user_1',
        method: 'PUT',
        body: {},
      },
    ])
  })

  it('surfaces an expired Okta token without exposing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('okta-token invalid', { status: 401 })))
    const failure = oktaConnector.executeRead!({
      source: source(),
      capabilityName: 'users.get',
      args: { userId: 'user_1' },
      idempotencyKey: 'read-2',
    })

    await expect(failure).rejects.toMatchObject({ name: 'CredentialsExpired' })
    await expect(failure).rejects.not.toThrow('okta-token')
  })
})
