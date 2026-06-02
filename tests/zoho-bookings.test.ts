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
    scopes: ['ZohoBokings.appointments.ALL'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'zoho_token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('zoho-bookings adapter manifest', () => {
  it('classifies itself as the calendar category and exposes the zoho-bookings kind', () => {
    expect(zohoBookingsConnector.manifest.kind).toBe('zoho-bookings')
    expect(zohoBookingsConnector.manifest.category).toBe('calendar')
    expect(zohoBookingsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = zohoBookingsConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the appointment + services + staff capability surface', () => {
    const names = zohoBookingsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'appointment.list',
        'appointment.get',
        'availability.fetch',
        'appointment.book',
        'appointment.reschedule',
        'appointment.cancel',
        'appointment.complete',
        'appointment.no-show',
        'services.list',
        'staff.list',
      ].sort(),
    )
    const reads = zohoBookingsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = zohoBookingsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'appointment.list',
        'appointment.get',
        'availability.fetch',
        'services.list',
        'staff.list',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'appointment.book',
        'appointment.reschedule',
        'appointment.cancel',
        'appointment.complete',
        'appointment.no-show',
      ].sort(),
    )
  })

  it('marks appointment.complete / appointment.no-show as native-idempotency external effect', () => {
    const targets = ['appointment.complete', 'appointment.no-show']
    for (const name of targets) {
      const cap = zohoBookingsConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, name).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas, name).toBe('native-idempotency')
      expect(cap.externalEffect, name).toBe(true)
    }
  })
})

describe('zoho-bookings services.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /bookings/v1/services with the Zoho-oauthtoken header prefix', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedAuth = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      const headers = init?.headers as Record<string, string> | undefined
      capturedAuth = headers?.authorization ?? headers?.Authorization ?? ''
      return jsonResponse([{ id: 'svc_1', name: 'Haircut' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zohoBookingsConnector.executeRead!({
      source: source(),
      capabilityName: 'services.list',
      args: {},
      idempotencyKey: 'r-1',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toBe('https://www.zohoapis.com/bookings/v1/services')
    expect(capturedAuth).toBe('Zoho-oauthtoken zoho_token')
    expect(result.data).toEqual([{ id: 'svc_1', name: 'Haircut' }])
  })
})

describe('zoho-bookings staff.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /bookings/v1/staff', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse([{ id: 'stf_1' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zohoBookingsConnector.executeRead!({
      source: source(),
      capabilityName: 'staff.list',
      args: { serviceId: 'svc_1' },
      idempotencyKey: 'r-2',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toBe('https://www.zohoapis.com/bookings/v1/staff?serviceId=svc_1')
    expect(result.data).toEqual([{ id: 'stf_1' }])
  })
})

describe('zoho-bookings appointment.complete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /bookings/v1/appointments/{appointmentId}/complete', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ id: 'apt_1', status: 'completed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zohoBookingsConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointment.complete',
      args: { appointmentId: 'apt_1' },
      idempotencyKey: 'k-1',
    })

    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toBe(
      'https://www.zohoapis.com/bookings/v1/appointments/apt_1/complete',
    )
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      zohoBookingsConnector.executeMutation!({
        source: source(),
        capabilityName: 'appointment.complete',
        args: { appointmentId: 'apt_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('zoho-bookings appointment.no-show', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /bookings/v1/appointments/{appointmentId}/no-show', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ id: 'apt_1', status: 'no_show' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zohoBookingsConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointment.no-show',
      args: { appointmentId: 'apt_1' },
      idempotencyKey: 'k-2',
    })

    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toBe(
      'https://www.zohoapis.com/bookings/v1/appointments/apt_1/no-show',
    )
    expect(result.status).toBe('committed')
  })
})
