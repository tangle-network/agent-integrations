import { afterEach, describe, expect, it, vi } from 'vitest'
import { klaviyoConnector } from '../klaviyo.js'
import { validateConnectorManifest, type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'source_klaviyo',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'klaviyo',
  label: 'klaviyo',
  consistencyModel: 'authoritative',
  scopes: [
    'accounts:read',
    'profiles:read',
    'profiles:write',
    'lists:read',
    'lists:write',
    'events:write',
    'campaigns:read',
  ],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'klaviyo_access_token' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('klaviyo adapter', () => {
  it('ships a valid manifest', () => {
    const result = validateConnectorManifest(klaviyoConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('declares OAuth2 auth with the Klaviyo URLs and scopes wired to env vars', () => {
    expect(klaviyoConnector.manifest.kind).toBe('klaviyo')
    expect(klaviyoConnector.manifest.displayName).toBe('Klaviyo')
    expect(klaviyoConnector.manifest.auth.kind).toBe('oauth2')
    if (klaviyoConnector.manifest.auth.kind !== 'oauth2') throw new Error('expected oauth2')
    expect(klaviyoConnector.manifest.auth.authorizationUrl).toBe('https://www.klaviyo.com/oauth/authorize')
    expect(klaviyoConnector.manifest.auth.tokenUrl).toBe('https://a.klaviyo.com/oauth/token')
    expect(klaviyoConnector.manifest.auth.clientIdEnv).toBe('KLAVIYO_OAUTH_CLIENT_ID')
    expect(klaviyoConnector.manifest.auth.clientSecretEnv).toBe('KLAVIYO_OAUTH_CLIENT_SECRET')
    expect(klaviyoConnector.manifest.auth.scopes).toContain('profiles:write')
    expect(klaviyoConnector.manifest.auth.scopes).toContain('events:write')
  })

  it('publishes the v2024-10-15 capability surface (profiles + lists + events + campaigns)', () => {
    const names = klaviyoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'campaigns.search',
      'events.create',
      'lists.add-profiles',
      'lists.create',
      'lists.search',
      'profiles.get',
      'profiles.search',
      'profiles.update',
      'profiles.upsert',
    ])

    const readers = klaviyoConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutators = klaviyoConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(readers).toEqual(['campaigns.search', 'lists.search', 'profiles.get', 'profiles.search'])
    expect(mutators).toEqual(['events.create', 'lists.add-profiles', 'lists.create', 'profiles.update', 'profiles.upsert'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof klaviyoConnector.executeRead).toBe('function')
    expect(typeof klaviyoConnector.executeMutation).toBe('function')
  })

  it('upserts a profile via POST /api/profile-import with bearer auth, JSON:API content-type, and the revision header', async () => {
    const fetchMock = mockFetch({ data: { id: 'profile_1' } }, { status: 201 })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'profiles.upsert',
      args: {
        data: {
          type: 'profile',
          attributes: { email: 'ada@example.com', first_name: 'Ada' },
        },
      },
      idempotencyKey: 'profile_import_1',
    }

    const result = await klaviyoConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const call = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    const url = call[0]
    const init = call[1]
    expect(String(url)).toBe('https://a.klaviyo.com/api/profile-import')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer klaviyo_access_token',
      revision: '2024-10-15',
      'content-type': 'application/vnd.api+json',
    })
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({
      data: {
        type: 'profile',
        attributes: { email: 'ada@example.com', first_name: 'Ada' },
      },
    })
  })

  it('searches profiles via GET /api/profiles with JSON:API filter and bracketed page params', async () => {
    const fetchMock = mockFetch({ data: [] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'profiles.search',
      args: { filter: 'equals(email,"ada@example.com")', pageSize: 25 },
      idempotencyKey: 'profile_search_1',
    }

    await klaviyoConnector.executeRead!(invocation)

    const call = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    const url = call[0]
    expect(url.pathname).toBe('/api/profiles')
    expect(url.searchParams.get('filter')).toBe('equals(email,"ada@example.com")')
    expect(url.searchParams.get('page[size]')).toBe('25')
    expect(url.searchParams.has('page[cursor]')).toBe(false)
    expect(url.searchParams.has('sort')).toBe(false)
  })

  it('emits a server-side event via POST /api/events', async () => {
    const fetchMock = mockFetch({}, { status: 202 })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'events.create',
      args: {
        data: {
          type: 'event',
          attributes: {
            properties: { Source: 'agent' },
            metric: { data: { type: 'metric', attributes: { name: 'Ordered Product' } } },
            profile: { data: { type: 'profile', attributes: { email: 'ada@example.com' } } },
          },
        },
      },
      idempotencyKey: 'event_1',
    }

    const result = await klaviyoConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const call = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(call[0])).toBe('https://a.klaviyo.com/api/events')
    expect(call[1].method).toBe('POST')
    const body = JSON.parse(String(call[1].body))
    expect(body.data.type).toBe('event')
    expect(body.data.attributes.metric.data.attributes.name).toBe('Ordered Product')
  })
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
