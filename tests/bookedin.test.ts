import { afterEach, describe, expect, it, vi } from 'vitest'
import { bookedinConnector } from '../src/connectors/adapters/bookedin.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bookedin_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bookedin',
    label: 'Bookedin test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bookedin-secret' },
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

describe('bookedin adapter manifest', () => {
  it('classifies itself as the crm category and exposes the bookedin kind', () => {
    expect(bookedinConnector.manifest.kind).toBe('bookedin')
    expect(bookedinConnector.manifest.category).toBe('crm')
    expect(bookedinConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = bookedinConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers leads CRUD + stats plus appointments create/cancel/reschedule', () => {
    const names = bookedinConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'leads.list',
        'leads.get',
        'leads.stats',
        'leads.create',
        'leads.update',
        'leads.delete',
        'appointments.create',
        'appointments.cancel',
        'appointments.reschedule',
      ].sort(),
    )
  })

  it('marks the new appointment mutations with native-idempotency CAS and external effect', () => {
    const targets = ['appointments.create', 'appointments.cancel', 'appointments.reschedule']
    for (const name of targets) {
      const cap = bookedinConnector.manifest.capabilities.find((c) => c.name === name)!
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('bookedin appointments.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/appointments with the booking payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'appt-1', status: 'booked' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bookedinConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointments.create',
      args: {
        leadId: 'lead-1',
        serviceId: 'svc-1',
        staffId: 'staff-1',
        startTime: '2026-06-10T15:00:00Z',
        endTime: '2026-06-10T16:00:00Z',
        notes: 'first session',
      },
      idempotencyKey: 'k-appt-create-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('https://api.bookedin.com/v1/appointments')
    expect(requestBody).toMatchObject({
      serviceId: 'svc-1',
      startTime: '2026-06-10T15:00:00Z',
    })
    expect(result.status).toBe('committed')
  })

  it('rejects when required serviceId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      bookedinConnector.executeMutation!({
        source: source(),
        capabilityName: 'appointments.create',
        args: {
          leadId: 'lead-1',
          staffId: 'staff-1',
          startTime: '2026-06-10T15:00:00Z',
          endTime: '2026-06-10T16:00:00Z',
          notes: 'first session',
        },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/serviceId/)
  })
})

describe('bookedin appointments.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/appointments/{id}/cancel with reason body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'appt-1', status: 'cancelled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bookedinConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointments.cancel',
      args: { appointmentId: 'appt-1', reason: 'customer-request' },
      idempotencyKey: 'k-appt-cancel-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('https://api.bookedin.com/v1/appointments/appt-1/cancel')
    expect(requestBody).toMatchObject({ reason: 'customer-request' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      bookedinConnector.executeMutation!({
        source: source(),
        capabilityName: 'appointments.cancel',
        args: { appointmentId: 'appt-1', reason: 'unused' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('bookedin appointments.reschedule', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/appointments/{id}/reschedule with new times', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'appt-1', status: 'rescheduled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bookedinConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointments.reschedule',
      args: {
        appointmentId: 'appt-1',
        startTime: '2026-06-11T16:00:00Z',
        endTime: '2026-06-11T17:00:00Z',
        staffId: 'staff-2',
      },
      idempotencyKey: 'k-appt-resched-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain(
      'https://api.bookedin.com/v1/appointments/appt-1/reschedule',
    )
    expect(requestBody).toMatchObject({ startTime: '2026-06-11T16:00:00Z' })
    expect(result.status).toBe('committed')
  })

  it('rejects when required startTime is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      bookedinConnector.executeMutation!({
        source: source(),
        capabilityName: 'appointments.reschedule',
        args: {
          appointmentId: 'appt-1',
          endTime: '2026-06-11T17:00:00Z',
          staffId: 'staff-2',
        },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/startTime/)
  })
})
