import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendlyConnector } from '../calendly.js'
import { validateConnectorManifest, type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'source_calendly',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'calendly',
  label: 'calendly',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'cal_access_token' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('calendly adapter', () => {
  it('ships a valid connector manifest', () => {
    const result = validateConnectorManifest(calendlyConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('declares oauth2 against auth.calendly.com with the documented endpoints', () => {
    const auth = calendlyConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth.kind narrowing failed')
    expect(auth.authorizationUrl).toBe('https://auth.calendly.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://auth.calendly.com/oauth/token')
    // Calendly OAuth2 grants are account-wide — the upstream rejects a `scope` param.
    expect(auth.scopes).toEqual([])
    expect(auth.clientIdEnv).toBe('CALENDLY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('CALENDLY_OAUTH_CLIENT_SECRET')
  })

  it('exposes the calendly action surface and the right read/mutation split', () => {
    expect(calendlyConnector.manifest.kind).toBe('calendly')
    expect(calendlyConnector.manifest.displayName).toBe('Calendly')
    expect(calendlyConnector.manifest.category).toBe('calendar')
    const names = calendlyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'event-types.get',
      'event-types.list',
      'invitee.no-show.create',
      'scheduled-events.cancel',
      'scheduled-events.get',
      'scheduled-events.list',
      'scheduled-events.list-invitees',
      'scheduling-links.create',
      'scheduling-links.delete',
      'user.get-current',
      'webhooks.create',
      'webhooks.delete',
    ])
    const readers = calendlyConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutators = calendlyConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(readers).toEqual([
      'event-types.get',
      'event-types.list',
      'scheduled-events.get',
      'scheduled-events.list',
      'scheduled-events.list-invitees',
      'user.get-current',
    ])
    expect(mutators).toEqual([
      'invitee.no-show.create',
      'scheduled-events.cancel',
      'scheduling-links.create',
      'scheduling-links.delete',
      'webhooks.create',
      'webhooks.delete',
    ])
  })

  it('every mutation declares a CAS strategy', () => {
    for (const cap of calendlyConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas).toBeDefined()
        expect(cap.cas).not.toBe('none')
      }
    }
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof calendlyConnector.executeRead).toBe('function')
    expect(typeof calendlyConnector.executeMutation).toBe('function')
  })

  it('reads scheduled events via GET /scheduled_events with bearer auth and the requested query filters', async () => {
    const fetchMock = mockFetch({ collection: [] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'scheduled-events.list',
      args: {
        user: 'https://api.calendly.com/users/ABC123',
        status: 'active',
        count: 25,
      },
      idempotencyKey: 'list_1',
    }

    await calendlyConnector.executeRead!(invocation)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://api.calendly.com')
    expect(url.pathname).toBe('/scheduled_events')
    expect(url.searchParams.get('user')).toBe('https://api.calendly.com/users/ABC123')
    expect(url.searchParams.get('status')).toBe('active')
    expect(url.searchParams.get('count')).toBe('25')
    // `organization` / `page_token` were not provided — declarative-REST must omit empty query params.
    expect(url.searchParams.has('organization')).toBe(false)
    expect(url.searchParams.has('page_token')).toBe(false)
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer cal_access_token' })
  })

  it('cancels a scheduled event via POST /scheduled_events/{uuid}/cancellation with the reason body', async () => {
    const fetchMock = mockFetch({ resource: { canceled: true } })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'scheduled-events.cancel',
      args: { uuid: 'event_42', reason: 'Reschedule requested by host.' },
      idempotencyKey: 'cancel_1',
    }

    const result = await calendlyConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/scheduled_events/event_42/cancellation')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer cal_access_token',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'Reschedule requested by host.' })
  })

  it('creates a single-use scheduling link tagged owner_type=EventType', async () => {
    const fetchMock = mockFetch({ resource: { booking_url: 'https://calendly.com/d/abc-xyz' } })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'scheduling-links.create',
      args: {
        owner: 'https://api.calendly.com/event_types/ET999',
        max_event_count: 1,
      },
      idempotencyKey: 'link_1',
    }

    const result = await calendlyConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/scheduling_links')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      owner: 'https://api.calendly.com/event_types/ET999',
      owner_type: 'EventType',
      max_event_count: 1,
    })
  })
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
