import { afterEach, describe, expect, it, vi } from 'vitest'
import { brazeConnector } from '../braze.js'
import { type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'source_braze',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'braze',
  label: 'braze',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: { restEndpoint: 'https://rest.iad-01.braze.com' },
  credentials: { kind: 'api-key', apiKey: 'braze-rest-key-xyz' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('braze adapter', () => {
  it('routes users.track against the per-tenant REST endpoint with bearer auth and a verbatim body', async () => {
    const fetchMock = mockFetch({ message: 'success' })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'users.track',
      args: {
        events: [
          {
            external_id: 'user_42',
            name: 'agent.took_action',
            time: '2026-05-31T00:00:00Z',
            properties: { action: 'opened_email' },
          },
        ],
      },
      idempotencyKey: 'track_1',
    }

    const result = await brazeConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://rest.iad-01.braze.com')
    expect(url.pathname).toBe('/users/track')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer braze-rest-key-xyz',
      'content-type': 'application/json',
    })
    const body = JSON.parse(String(init.body))
    expect(body.events[0].external_id).toBe('user_42')
    expect(body.events[0].name).toBe('agent.took_action')
    expect(body.events[0].properties).toEqual({ action: 'opened_email' })
  })

  it('triggers a campaign send via POST /campaigns/trigger/send', async () => {
    const fetchMock = mockFetch({ dispatch_id: 'd_1', message: 'success' })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'campaigns.trigger.send',
      args: {
        campaign_id: 'camp_abc',
        recipients: [{ external_user_id: 'user_42', trigger_properties: { foo: 'bar' } }],
      },
      idempotencyKey: 'camp_send_1',
    }

    const result = await brazeConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/campaigns/trigger/send')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body.campaign_id).toBe('camp_abc')
    expect(body.recipients[0].external_user_id).toBe('user_42')
  })

  it('lists campaigns via GET /campaigns/list with paging params (omits undefined params)', async () => {
    const fetchMock = mockFetch({ campaigns: [] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'campaigns.list',
      args: { page: 0, include_archived: false },
      idempotencyKey: 'list_1',
    }

    await brazeConnector.executeRead!(invocation)

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/campaigns/list')
    expect(url.searchParams.get('page')).toBe('0')
    expect(url.searchParams.get('include_archived')).toBe('false')
    expect(url.searchParams.has('sort_direction')).toBe(false)
    expect(url.searchParams.has('last_edit.time[gt]')).toBe(false)
  })

  it('exports users via POST /users/export/ids', async () => {
    const fetchMock = mockFetch({ users: [] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'users.export.ids',
      args: { external_ids: ['user_42'], fields_to_export: ['email', 'first_name'] },
      idempotencyKey: 'export_1',
    }

    await brazeConnector.executeRead!(invocation)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/users/export/ids')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: 'Bearer braze-rest-key-xyz' })
    const body = JSON.parse(String(init.body))
    expect(body.external_ids).toEqual(['user_42'])
    expect(body.fields_to_export).toEqual(['email', 'first_name'])
  })

  it('fails loud when metadata.restEndpoint is missing rather than calling a default cluster', async () => {
    const fetchMock = mockFetch({ message: 'success' })
    const invocation: ConnectorInvocation = {
      source: { ...source, metadata: {} },
      capabilityName: 'users.track',
      args: { events: [{ external_id: 'u', name: 'e', time: '2026-05-31T00:00:00Z' }] },
      idempotencyKey: 'track_no_endpoint',
    }

    await expect(brazeConnector.executeMutation!(invocation)).rejects.toThrow(/restEndpoint/)
    expect(fetchMock).not.toHaveBeenCalled()
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
