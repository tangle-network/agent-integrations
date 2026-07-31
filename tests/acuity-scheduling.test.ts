import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONNECTOR_ADAPTER_FACTORIES } from '../src/connectors/adapters/factories.js'
import { acuitySchedulingConnector } from '../src/connectors/adapters/acuity-scheduling.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return {
    id: 'source_acuity',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'acuity-scheduling',
    label: 'Acuity test',
    consistencyModel: 'authoritative',
    scopes: ['api-v1'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'acuity-token' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Acuity Scheduling provider pack', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('registers the documented OAuth application', () => {
    expect(acuitySchedulingConnector.manifest.auth).toMatchObject({
      kind: 'oauth2',
      authorizationUrl: 'https://acuityscheduling.com/oauth2/authorize',
      tokenUrl: 'https://acuityscheduling.com/oauth2/token',
      scopes: ['api-v1'],
    })

    expect(CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'acuity-scheduling',
    )?.envMap).toEqual({
      clientId: 'ACUITY_OAUTH_CLIENT_ID',
      clientSecret: 'ACUITY_OAUTH_CLIENT_SECRET',
    })
  })

  it('covers scheduling discovery and requires approval for every write', () => {
    expect(acuitySchedulingConnector.manifest.capabilities.map(
      (capability) => capability.name,
    ).sort()).toEqual([
      'appointment-types.list',
      'appointments.cancel',
      'appointments.create',
      'appointments.get',
      'appointments.list',
      'appointments.reschedule',
      'availability.dates',
      'availability.times',
      'blocks.list',
      'calendars.list',
      'clients.list',
    ])

    for (const capability of acuitySchedulingConnector.manifest.capabilities) {
      if (capability.class === 'mutation') {
        expect(capability.externalEffect, capability.name).toBe(true)
      }
    }
  })

  it('sends availability filters to the documented dates route', async () => {
    let requestUrl = ''
    let authorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return jsonResponse([{ date: '2026-08-03' }])
    }))

    await acuitySchedulingConnector.executeRead!({
      source: source(),
      capabilityName: 'availability.dates',
      args: {
        month: '2026-08',
        appointmentTypeID: 42,
        calendarID: 7,
        timezone: 'America/Los_Angeles',
      },
      idempotencyKey: 'availability-1',
    })

    const url = new URL(requestUrl)
    expect(url.origin + url.pathname).toBe('https://acuityscheduling.com/api/v1/availability/dates')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      month: '2026-08',
      appointmentTypeID: '42',
      calendarID: '7',
      timezone: 'America/Los_Angeles',
    })
    expect(authorization).toBe('Bearer acuity-token')
  })

  it('creates an appointment without changing the provider field names', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ id: 99 })
    }))

    const result = await acuitySchedulingConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointments.create',
      args: {
        appointmentTypeID: 42,
        datetime: '2026-08-03T10:00:00-07:00',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        calendarID: 7,
        admin: true,
        owner: 'attacker-controlled-extra-field',
      },
      idempotencyKey: 'appointment-create-1',
    })

    expect(requestUrl).toBe('https://acuityscheduling.com/api/v1/appointments?admin=true')
    expect(requestMethod).toBe('POST')
    expect(requestBody).toEqual({
      appointmentTypeID: 42,
      datetime: '2026-08-03T10:00:00-07:00',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      calendarID: 7,
    })
    expect(result.status).toBe('committed')
  })

  it('keeps path ids out of reschedule and cancel request bodies', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return jsonResponse({ id: 99 })
    }))

    await acuitySchedulingConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointments.reschedule',
      args: {
        appointmentId: 99,
        datetime: '2026-08-04T11:00:00-07:00',
        calendarID: 8,
        admin: true,
        noEmail: true,
      },
      idempotencyKey: 'appointment-reschedule-1',
    })
    await acuitySchedulingConnector.executeMutation!({
      source: source(),
      capabilityName: 'appointments.cancel',
      args: {
        appointmentId: 99,
        cancelNote: 'Client called to cancel',
        noShow: true,
        admin: true,
        noEmail: true,
      },
      idempotencyKey: 'appointment-cancel-1',
    })

    expect(requests).toEqual([
      {
        url: 'https://acuityscheduling.com/api/v1/appointments/99/reschedule?admin=true&noEmail=true',
        body: { datetime: '2026-08-04T11:00:00-07:00', calendarID: 8 },
      },
      {
        url: 'https://acuityscheduling.com/api/v1/appointments/99/cancel?admin=true&noEmail=true',
        body: { cancelNote: 'Client called to cancel', noShow: true },
      },
    ])
  })

  it('reports revoked OAuth credentials distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)))
    await expect(acuitySchedulingConnector.test(source())).resolves.toEqual({
      ok: false,
      reason: 'Acuity Scheduling rejected credentials (401)',
    })
  })
})
