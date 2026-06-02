import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  googleCalendar,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_cal_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'google-calendar',
    label: 'Drew Calendar',
    consistencyModel: 'authoritative',
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    metadata: { calendarId: 'primary' },
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

describe('google-calendar adapter — event CRUD', () => {
  const adapter = googleCalendar({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest exposes the new event CRUD capabilities + scope', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'book_slot',
      'create_event',
      'delete_event',
      'get_event',
      'list_availability',
      'list_events',
      'update_event',
    ])
    // Default consent must include the fine-grained events scope.
    const auth = adapter.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.scopes).toContain(
      'https://www.googleapis.com/auth/calendar.events',
    )
    // create_event / update_event / delete_event are mutations w/ idempotency + externalEffect.
    for (const name of ['create_event', 'update_event', 'delete_event']) {
      const cap = adapter.manifest.capabilities.find((c) => c.name === name)
      if (!cap || cap.class !== 'mutation') {
        throw new Error(`expected ${name} to be a mutation capability`)
      }
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  // ---------- create_event ----------

  it('create_event POSTs the right URL/body and returns committed event metadata', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? 'GET'
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({
        id: 'evt_1',
        etag: '"etag-after"',
        htmlLink: 'https://calendar.google.com/event?eid=evt_1',
        hangoutLink: 'https://meet.google.com/abc-def-ghi',
        status: 'confirmed',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'create_event',
      args: {
        start: '2026-06-10T14:00:00Z',
        end: '2026-06-10T15:00:00Z',
        summary: 'Sync with Drew',
        description: 'agenda...',
        location: 'Zoom',
        attendees: ['a@example.com', 'b@example.com'],
        sendUpdates: 'all',
      },
      idempotencyKey: 'idemp-create-1',
    })

    expect(calledMethod).toBe('POST')
    expect(calledUrl).toContain('/calendars/primary/events')
    expect(calledUrl).toContain('sendUpdates=all')
    expect(calledUrl).toContain('requestId=idemp-create-1')
    expect(calledBody).toMatchObject({
      summary: 'Sync with Drew',
      description: 'agenda...',
      location: 'Zoom',
      start: { dateTime: '2026-06-10T14:00:00Z' },
      end: { dateTime: '2026-06-10T15:00:00Z' },
      attendees: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(false)
      expect(result.etagAfter).toBe('"etag-after"')
      const data = result.data as {
        eventId: string
        htmlLink: string
        hangoutLink: string
        eventStatus: string
      }
      expect(data.eventId).toBe('evt_1')
      expect(data.hangoutLink).toContain('meet.google.com')
      expect(data.eventStatus).toBe('confirmed')
      expect(typeof result.committedAt).toBe('number')
    }
  })

  it('create_event rejects missing start/end/summary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_event',
        args: { end: '2026-06-10T15:00:00Z', summary: 's' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`start` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_event',
        args: { start: '2026-06-10T14:00:00Z', summary: 's' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`end` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_event',
        args: { start: '2026-06-10T14:00:00Z', end: '2026-06-10T15:00:00Z' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`summary` is required/)
  })

  it('create_event surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_event',
        args: {
          start: '2026-06-10T14:00:00Z',
          end: '2026-06-10T15:00:00Z',
          summary: 's',
        },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('create_event surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_event',
        args: {
          start: '2026-06-10T14:00:00Z',
          end: '2026-06-10T15:00:00Z',
          summary: 's',
        },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // ---------- update_event ----------

  it('update_event PATCHes only the supplied fields', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input)
        calledMethod = init?.method ?? 'GET'
        calledBody = JSON.parse(init!.body as string)
        return jsonResponse({
          id: 'evt_42',
          etag: '"etag-after"',
          htmlLink: 'https://calendar.google.com/event?eid=evt_42',
          status: 'confirmed',
        })
      }),
    )

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'update_event',
      args: {
        eventId: 'evt_42',
        summary: 'New title',
        sendUpdates: 'externalOnly',
      },
      idempotencyKey: 'k',
    })

    expect(calledMethod).toBe('PATCH')
    expect(calledUrl).toContain('/calendars/primary/events/evt_42')
    expect(calledUrl).toContain('sendUpdates=externalOnly')
    // Only `summary` should be in the body — none of the unsupplied fields.
    expect(calledBody).toEqual({ summary: 'New title' })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.etagAfter).toBe('"etag-after"')
      expect((result.data as { eventId: string }).eventId).toBe('evt_42')
    }
  })

  it('update_event rejects missing eventId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'update_event',
        args: { summary: 'oops' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`eventId` is required/)
  })

  it('update_event surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'update_event',
        args: { eventId: 'evt_1', summary: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // ---------- delete_event ----------

  it('delete_event sends DELETE and returns ok:true', async () => {
    let calledUrl = ''
    let calledMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input)
        calledMethod = init?.method ?? 'GET'
        return new Response(null, { status: 204 })
      }),
    )

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'delete_event',
      args: { eventId: 'evt_99' },
      idempotencyKey: 'k',
    })
    expect(calledMethod).toBe('DELETE')
    expect(calledUrl).toContain('/calendars/primary/events/evt_99')
    expect(calledUrl).toContain('sendUpdates=none')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(false)
      expect(result.data).toMatchObject({ ok: true, eventId: 'evt_99' })
    }
  })

  it('delete_event treats 404/410 as idempotent success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 410 })))
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'delete_event',
      args: { eventId: 'evt_gone' },
      idempotencyKey: 'k',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(true)
    }
  })

  it('delete_event rejects missing eventId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'delete_event',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`eventId` is required/)
  })

  it('delete_event surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'delete_event',
        args: { eventId: 'evt_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // ---------- get_event ----------

  it('get_event GETs the event and returns the raw object', async () => {
    let calledUrl = ''
    let calledMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input)
        calledMethod = init?.method ?? 'GET'
        return jsonResponse({
          id: 'evt_1',
          etag: '"e"',
          summary: 'Sync',
          htmlLink: 'https://calendar.google.com/event?eid=evt_1',
          status: 'confirmed',
          attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }],
        })
      }),
    )

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'get_event',
      args: { eventId: 'evt_1' },
      idempotencyKey: 'k',
    })
    expect(calledMethod).toBe('GET')
    expect(calledUrl).toContain('/calendars/primary/events/evt_1')
    const data = result.data as { id: string; summary: string; attendees: unknown[] }
    expect(data.id).toBe('evt_1')
    expect(data.summary).toBe('Sync')
    expect(data.attendees).toHaveLength(1)
    expect(typeof result.fetchedAt).toBe('number')
  })

  it('get_event rejects missing eventId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'get_event',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`eventId` is required/)
  })

  it('get_event surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })))
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'get_event',
        args: { eventId: 'evt_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // ---------- list_events ----------

  it('list_events forwards timeMin/timeMax/q/maxResults and returns items+nextPageToken', async () => {
    let calledUrl = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input)
        return jsonResponse({
          items: [
            { id: 'evt_1', summary: 'a' },
            { id: 'evt_2', summary: 'b' },
          ],
          nextPageToken: 'tok',
        })
      }),
    )

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_events',
      args: {
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-07-01T00:00:00Z',
        q: 'standup',
        maxResults: 10,
      },
      idempotencyKey: 'k',
    })
    expect(calledUrl).toContain('/calendars/primary/events?')
    expect(calledUrl).toContain('timeMin=2026-06-01T00%3A00%3A00Z')
    expect(calledUrl).toContain('timeMax=2026-07-01T00%3A00%3A00Z')
    expect(calledUrl).toContain('q=standup')
    expect(calledUrl).toContain('maxResults=10')
    expect(calledUrl).toContain('singleEvents=true')
    expect(calledUrl).toContain('orderBy=startTime')
    const data = result.data as {
      items: Array<{ id: string }>
      nextPageToken?: string
    }
    expect(data.items).toHaveLength(2)
    expect(data.nextPageToken).toBe('tok')
    expect(typeof result.fetchedAt).toBe('number')
  })

  it('list_events surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'list_events',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
