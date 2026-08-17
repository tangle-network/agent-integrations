import { afterEach, describe, expect, it, vi } from 'vitest'
import { zohoBookingsConnector } from '../src/connectors/adapters/zoho-bookings.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_zoho_bookings_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'zoho-bookings',
    label: 'Zoho Bookings test',
    consistencyModel: 'authoritative',
    scopes: ['zohobookings.data.READ', 'zohobookings.data.CREATE'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'zoho_token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  })
}

describe('zoho-bookings adapter manifest', () => {
  it('uses the shared Zoho OAuth app with the exact comma-delimited Bookings scopes', () => {
    expect(zohoBookingsConnector.manifest.kind).toBe('zoho-bookings')
    expect(zohoBookingsConnector.manifest.category).toBe('calendar')
    expect(zohoBookingsConnector.manifest.defaultConsistencyModel).toBe('authoritative')

    const auth = zohoBookingsConnector.manifest.auth
    expect(auth).toMatchObject({
      kind: 'oauth2',
      clientIdEnv: 'ZOHO_OAUTH_CLIENT_ID',
      clientSecretEnv: 'ZOHO_OAUTH_CLIENT_SECRET',
      scopes: ['zohobookings.data.CREATE', 'zohobookings.data.READ'],
      scopeSeparator: ',',
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    })
  })

  it('exposes only documented Bookings operations and requires approval for every write', () => {
    const names = zohoBookingsConnector.manifest.capabilities.map((capability) => capability.name).sort()
    expect(names).toEqual([
      'appointments.book',
      'appointments.cancel',
      'appointments.get',
      'appointments.list',
      'appointments.reschedule',
      'availability.fetch',
      'resources.list',
      'services.list',
      'staff.list',
      'workspaces.list',
    ])

    const mutations = zohoBookingsConnector.manifest.capabilities.filter(
      (capability) => capability.class === 'mutation',
    )
    expect(mutations.map((capability) => capability.name).sort()).toEqual([
      'appointments.book',
      'appointments.cancel',
      'appointments.reschedule',
    ])
    for (const capability of mutations) {
      expect(capability.externalEffect, capability.name).toBe(true)
      expect(capability.requiredScopes, capability.name).toEqual(['zohobookings.data.CREATE'])
    }
  })
})

describe('zoho-bookings direct execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('routes regional service discovery through the documented JSON API', async () => {
    let request: { url?: string; method?: string; authorization?: string } = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      request = {
        url: String(input),
        method: init?.method,
        authorization: headers.get('authorization') ?? undefined,
      }
      return jsonResponse({ response: { returnvalue: { data: [{ id: 'svc_1' }] } } })
    }))

    await zohoBookingsConnector.executeRead!({
      source: source({ metadata: { zohoLocation: 'zoho.eu' } }),
      capabilityName: 'services.list',
      args: { workspace_id: 'workspace 1' },
      idempotencyKey: 'read-1',
    })

    expect(request).toEqual({
      url: 'https://www.zohoapis.eu/bookings/v1/json/services?workspace_id=workspace+1',
      method: 'GET',
      authorization: 'Zoho-oauthtoken zoho_token',
    })
  })

  it('uses the provider staff route and snake-case service filter', async () => {
    let url = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      url = String(input)
      return jsonResponse({ response: { returnvalue: { data: [] } } })
    }))

    await zohoBookingsConnector.executeRead!({
      source: source(),
      capabilityName: 'staff.list',
      args: { service_id: 'svc_1' },
      idempotencyKey: 'read-2',
    })

    expect(url).toBe('https://www.zohoapis.com/bookings/v1/json/staffs?service_id=svc_1')
  })

  it('posts appointment filters as the provider data form field', async () => {
    let url = ''
    let contentType = ''
    let body = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      contentType = new Headers(init?.headers).get('content-type') ?? ''
      body = String(init?.body)
      return jsonResponse({ response: { returnvalue: { response: [] } } })
    }))

    await zohoBookingsConnector.executeRead!({
      source: source(),
      capabilityName: 'appointments.list',
      args: { from_time: '31-Jul-2026 09:00:00', status: 'upcoming' },
      idempotencyKey: 'read-3',
    })

    expect(url).toBe('https://www.zohoapis.com/bookings/v1/json/fetchappointment')
    expect(contentType).toBe('application/x-www-form-urlencoded')
    expect(JSON.parse(new URLSearchParams(body).get('data') ?? '{}')).toEqual({
      from_time: '31-Jul-2026 09:00:00',
      status: 'upcoming',
    })
  })

  it('books through the provider form API and preserves structured customer fields', async () => {
    let body = ''
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body)
      return jsonResponse({ response: { status: 'success', returnvalue: { booking_id: 'booking_1' } } })
    }))

    const result = await zohoBookingsConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointments.book',
      args: {
        service_id: 'svc_1',
        from_time: '31-Jul-2026 09:00:00',
        staff_id: 'staff_1',
        customer_details: { name: 'Ada', email: 'ada@example.com', phone_number: '+15555550100' },
        additional_fields: { source: 'Tangle' },
      },
      idempotencyKey: 'write-1',
    })

    const form = new URLSearchParams(body)
    expect(form.get('service_id')).toBe('svc_1')
    expect(form.get('staff_id')).toBe('staff_1')
    expect(JSON.parse(form.get('customer_details') ?? '{}')).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
      phone_number: '+15555550100',
    })
    expect(JSON.parse(form.get('additional_fields') ?? '{}')).toEqual({ source: 'Tangle' })
    expect(result.status).toBe('committed')
  })

  it('rejects ambiguous assignments before sending a booking', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(zohoBookingsConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointments.book',
      args: {
        service_id: 'svc_1',
        from_time: '31-Jul-2026 09:00:00',
        staff_id: 'staff_1',
        resource_id: 'resource_1',
        customer_details: { name: 'Ada' },
      },
      idempotencyKey: 'write-2',
    })).rejects.toThrow('exactly one booking assignment is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels through updateappointment and surfaces expired credentials', async () => {
    let body = ''
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body)
      return new Response('unauthorized', { status: 401 })
    }))

    await expect(zohoBookingsConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointments.cancel',
      args: { booking_id: 'booking_1' },
      idempotencyKey: 'write-3',
    })).rejects.toMatchObject({ name: 'CredentialsExpired' })
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
      booking_id: 'booking_1',
      action: 'cancel',
    })
  })

  it('returns a typed throttle with a bounded retry delay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow down', {
      status: 429,
      headers: { 'retry-after': '2' },
    })))

    await expect(zohoBookingsConnector.executeRead!({
      source: source(),
      capabilityName: 'workspaces.list',
      args: {},
      idempotencyKey: 'read-4',
    })).rejects.toMatchObject({ name: 'ProviderRateLimited', retryAfterMs: 2_000 })
  })

  it('rejects lookalike data-center hosts before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(zohoBookingsConnector.executeRead!({
      source: source({ metadata: { zohoLocation: 'zoho.eu.attacker.test' } }),
      capabilityName: 'workspaces.list',
      args: {},
      idempotencyKey: 'read-5',
    })).rejects.toThrow('zohoLocation is not an allowed Zoho data center')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
