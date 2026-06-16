import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  microsoftCalendar,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_mscal_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'microsoft-calendar',
    label: 'Drew Outlook Calendar',
    consistencyModel: 'authoritative',
    scopes: ['https://graph.microsoft.com/Calendars.ReadWrite'],
    metadata: { userPrincipal: 'me' },
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

describe('microsoft-calendar adapter', () => {
  const adapter = microsoftCalendar({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest declares Graph OAuth + the four capabilities', () => {
    expect(adapter.manifest.kind).toBe('microsoft-calendar')
    expect(adapter.manifest.auth.kind).toBe('oauth2')
    if (adapter.manifest.auth.kind === 'oauth2') {
      expect(adapter.manifest.auth.authorizationUrl).toContain('login.microsoftonline.com')
      expect(adapter.manifest.auth.tokenUrl).toContain('login.microsoftonline.com')
      expect(adapter.manifest.auth.clientIdEnv).toBe('MS_OAUTH_CLIENT_ID')
      expect(adapter.manifest.auth.clientSecretEnv).toBe('MS_OAUTH_CLIENT_SECRET')
      expect(adapter.manifest.auth.scopes).toContain('https://graph.microsoft.com/Calendars.ReadWrite')
      expect(adapter.manifest.auth.scopes).toContain('offline_access')
    }
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'book_slot',
      'delete_event',
      'list_availability',
      'list_events',
    ])
  })

  it('list_events with NO calendarId hits /me/events and maps value→events + nextLink', async () => {
    let calledUrl = ''
    let calledMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? 'GET'
      return jsonResponse({
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/events?$skiptoken=AAA',
        value: [{ id: 'evt1', subject: 'Standup' }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_events',
      args: {},
      idempotencyKey: 'k1',
    })
    expect(calledMethod).toBe('GET')
    expect(calledUrl).toBe('https://graph.microsoft.com/v1.0/me/events')
    expect(calledUrl).not.toContain('/me/calendars/')
    const data = result.data as {
      events: Array<{ id: string; subject: string }>
      nextLink?: string
    }
    expect(data.events).toEqual([{ id: 'evt1', subject: 'Standup' }])
    expect(data.nextLink).toBe('https://graph.microsoft.com/v1.0/me/events?$skiptoken=AAA')
    expect(result.fetchedAt).toBeTypeOf('number')
  })

  it('list_events WITH calendarId hits /me/calendars/{calendarId}/events (collapse branch)', async () => {
    let calledUrl = ''
    let calledMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? 'GET'
      return jsonResponse({ value: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_events',
      args: { calendarId: 'cal-42' },
      idempotencyKey: 'k1',
    })
    expect(calledMethod).toBe('GET')
    expect(calledUrl).toBe('https://graph.microsoft.com/v1.0/me/calendars/cal-42/events')
    const data = result.data as { events: unknown[]; nextLink?: string }
    expect(data.events).toEqual([])
    expect(data.nextLink).toBeUndefined()
  })

  it('list_events url-encodes the calendarId segment', async () => {
    let calledUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input)
      return jsonResponse({ value: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_events',
      args: { calendarId: 'cal id/with#slash' },
      idempotencyKey: 'k1',
    })
    expect(calledUrl).toBe(
      `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent('cal id/with#slash')}/events`,
    )
  })

  it('delete_event DELETEs /me/events/{eventId} and returns committed', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let ifMatch: string | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      ifMatch = new Headers(init?.headers).get('if-match')
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'delete_event',
      args: { eventId: 'evt-99' },
      idempotencyKey: 'k1',
    })
    expect(calledMethod).toBe('DELETE')
    expect(calledUrl).toBe('https://graph.microsoft.com/v1.0/me/events/evt-99')
    // No expectedEtag on the invocation → no If-Match header sent.
    expect(ifMatch).toBeNull()
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(false)
      expect(result.data).toMatchObject({ eventId: 'evt-99', deleted: true })
      expect((result.data as { alreadyMissing?: boolean }).alreadyMissing).toBeUndefined()
    }
  })

  it('delete_event wires If-Match when invocation carries expectedEtag', async () => {
    let ifMatch: string | null = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      ifMatch = new Headers(init?.headers).get('if-match')
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'delete_event',
      args: { eventId: 'evt-99' },
      expectedEtag: 'W/"etag-7"',
      idempotencyKey: 'k1',
    })
    expect(ifMatch).toBe('W/"etag-7"')
  })

  it('delete_event maps 404 to an idempotent tombstone (no throw)', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'delete_event',
      args: { eventId: 'gone' },
      idempotencyKey: 'k1',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(true)
      expect(result.data).toMatchObject({
        eventId: 'gone',
        deleted: true,
        alreadyMissing: true,
      })
    }
  })

  it('delete_event surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'delete_event',
        args: { eventId: 'evt-99' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
