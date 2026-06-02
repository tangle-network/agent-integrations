import { afterEach, describe, expect, it, vi } from 'vitest'
import { calComConnector } from '../src/connectors/adapters/cal-com.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_cal_com_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'cal-com',
    label: 'Cal.com test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'cal_token' },
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

describe('cal-com adapter manifest', () => {
  it('exposes the cal-com kind in the calendar category', () => {
    expect(calComConnector.manifest.kind).toBe('cal-com')
    expect(calComConnector.manifest.category).toBe('calendar')
  })

  it('marks the new write capabilities as native-idempotency external effect', () => {
    const caps = calComConnector.manifest.capabilities
    const targets = ['bookings.update', 'event-types.create', 'event-types.delete', 'schedules.create']
    for (const name of targets) {
      const cap = caps.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap) continue
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('cal-com bookings.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v2/bookings/{uid} with the metadata body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ uid: 'bk_123' })
      }),
    )
    const result = await calComConnector.executeMutation!({
      source: source(),
      capabilityName: 'bookings.update',
      args: { bookingUid: 'bk_123', metadata: { foo: 'bar' } },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v2/bookings/bk_123')
    expect(requestBody).toEqual({ metadata: { foo: 'bar' } })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      calComConnector.executeMutation!({
        source: source(),
        capabilityName: 'bookings.update',
        args: { bookingUid: 'bk_123', metadata: {} },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('cal-com event-types.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v2/event-types with title/slug/lengthInMinutes body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 99 })
      }),
    )
    const result = await calComConnector.executeMutation!({
      source: source(),
      capabilityName: 'event-types.create',
      args: {
        title: 'Intro Call',
        slug: 'intro',
        lengthInMinutes: 30,
        description: 'Quick chat',
        locations: [{ type: 'integrations:google:meet' }],
        bookingFields: [],
        disableGuests: false,
      },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v2/event-types')
    expect(requestBody).toMatchObject({ title: 'Intro Call', slug: 'intro', lengthInMinutes: 30 })
    expect(result.status).toBe('committed')
  })
})

describe('cal-com event-types.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v2/event-types/{id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ ok: true })
      }),
    )
    const result = await calComConnector.executeMutation!({
      source: source(),
      capabilityName: 'event-types.delete',
      args: { eventTypeId: '77' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v2/event-types/77')
    expect(result.status).toBe('committed')
  })
})

describe('cal-com schedules.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v2/schedules with the schedule body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 1 })
      }),
    )
    const result = await calComConnector.executeMutation!({
      source: source(),
      capabilityName: 'schedules.create',
      args: {
        name: 'Weekday hours',
        timeZone: 'America/Los_Angeles',
        isDefault: true,
        availability: [{ days: ['Monday'], startTime: '09:00', endTime: '17:00' }],
        overrides: [],
      },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v2/schedules')
    expect(requestBody).toMatchObject({ name: 'Weekday hours', timeZone: 'America/Los_Angeles' })
    expect(result.status).toBe('committed')
  })
})
