import { afterEach, describe, expect, it, vi } from 'vitest'
import { savvycalConnector } from '../src/connectors/adapters/savvycal.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'src_savvycal_1',
  projectId: 'proj_1',
  publishedAgentId: null,
  kind: 'savvycal',
  label: 'SavvyCal test',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'savvycal_access_token' },
  status: 'active',
}

afterEach(() => vi.unstubAllGlobals())

function mockFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('savvycal execution', () => {
  it('creates links on /v1/links using only documented fields', async () => {
    const fetchMock = mockFetch({ id: 'link_1' }, 201)

    await savvycalConnector.executeMutation!({
      source,
      capabilityName: 'links.create',
      args: { name: 'Intro Call', description: 'A short call', type: 'recurring' },
      idempotencyKey: 'link-1',
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.savvycal.com/v1/links')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Intro Call',
      description: 'A short call',
      type: 'recurring',
    })
  })

  it('books an event through its link with SavvyCal field names', async () => {
    const fetchMock = mockFetch({ id: 'event_1' })

    await savvycalConnector.executeMutation!({
      source,
      capabilityName: 'events.create',
      args: {
        linkId: 'link_1',
        display_name: 'Ada Lovelace',
        email: 'ada@example.com',
        start_at: '2026-08-01T17:00:00Z',
        end_at: '2026-08-01T17:30:00Z',
        time_zone: 'America/Los_Angeles',
      },
      idempotencyKey: 'event-1',
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.savvycal.com/v1/links/link_1/events')
    expect(JSON.parse(String(init.body))).not.toHaveProperty('linkId')
    expect(JSON.parse(String(init.body))).toMatchObject({
      display_name: 'Ada Lovelace',
      email: 'ada@example.com',
      time_zone: 'America/Los_Angeles',
    })
  })

  it('cancels events through the POST cancel endpoint', async () => {
    const fetchMock = mockFetch({ id: 'event_1', state: 'canceled' })

    await savvycalConnector.executeMutation!({
      source,
      capabilityName: 'events.cancel',
      args: { eventId: 'event_1', cancel_reason: 'Schedule conflict' },
      idempotencyKey: 'cancel-1',
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.savvycal.com/v1/events/event_1/cancel')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ cancel_reason: 'Schedule conflict' })
  })

  it('lists slots with the documented from/until query names', async () => {
    const fetchMock = mockFetch({ entries: [] })

    await savvycalConnector.executeRead!({
      source,
      capabilityName: 'links.slots',
      args: { linkId: 'link_1', from: '2026-08-01T00:00:00Z', until: '2026-08-07T00:00:00Z' },
      idempotencyKey: 'slots-1',
    })

    const [url] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe(
      'https://api.savvycal.com/v1/links/link_1/slots?from=2026-08-01T00%3A00%3A00Z&until=2026-08-07T00%3A00%3A00Z',
    )
  })
})
