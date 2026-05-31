import { afterEach, describe, expect, it, vi } from 'vitest'
import { brazeConnector } from '../braze.js'
import { validateConnectorManifest, type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

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
  it('ships a valid connector manifest', () => {
    const result = validateConnectorManifest(brazeConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth with the Braze REST hint', () => {
    expect(brazeConnector.manifest.kind).toBe('braze')
    expect(brazeConnector.manifest.displayName).toBe('Braze')
    expect(brazeConnector.manifest.category).toBe('other')
    expect(brazeConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the customer-lifecycle capability surface with the right read/mutation split', () => {
    const names = brazeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'campaigns.list',
      'campaigns.trigger.send',
      'canvas.list',
      'canvas.trigger.send',
      'email.blacklist',
      'subscription.status.get',
      'subscription.status.set',
      'users.delete',
      'users.export.ids',
      'users.identify',
      'users.track',
    ])
    const readers = brazeConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutators = brazeConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(readers).toEqual(['campaigns.list', 'canvas.list', 'subscription.status.get', 'users.export.ids'])
    expect(mutators).toEqual([
      'campaigns.trigger.send',
      'canvas.trigger.send',
      'email.blacklist',
      'subscription.status.set',
      'users.delete',
      'users.identify',
      'users.track',
    ])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof brazeConnector.executeRead).toBe('function')
    expect(typeof brazeConnector.executeMutation).toBe('function')
  })

  it('declares every mutation with a CAS strategy and externalEffect=true', () => {
    for (const cap of brazeConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
      expect(cap.externalEffect).toBe(true)
    }
  })

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

  it('refuses to invoke unknown capabilities', async () => {
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'does.not.exist',
      args: {},
      idempotencyKey: 'bad_1',
    }
    await expect(brazeConnector.executeRead!(invocation)).rejects.toThrow(/unknown read capability/)
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
