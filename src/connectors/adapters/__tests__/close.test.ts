import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeConnector } from '../close.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_close',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'close',
  label: 'Close (Acme)',
  consistencyModel: 'authoritative',
  scopes: ['offline_access'],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'token_abc' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('close adapter execution', () => {
  it('builds a leads.search URL against the Close API host with bearer auth and interpolated query', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ id: 'lead_1', display_name: 'Tangle Inc.' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'leads.search',
      args: { query: 'name:Tangle', _limit: 25 },
      idempotencyKey: 'idem_1',
    }
    const result = await closeConnector.executeRead!(invocation)

    expect(result.data).toEqual({ data: [{ id: 'lead_1', display_name: 'Tangle Inc.' }] })
    const call = fetchMock.mock.calls[0]!
    const url = String(call[0])
    expect(url.startsWith('https://api.close.com/api/v1/lead/')).toBe(true)
    expect(url).toContain('query=name%3ATangle')
    expect(url).toContain('_limit=25')
    expect((call[1]!.headers as Record<string, string>).authorization).toBe('Bearer token_abc')
  })

  it('POSTs leads.create with an args body to the lead collection endpoint', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'lead_42', name: 'Tangle' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'leads.create',
      args: { name: 'Tangle', url: 'https://tangle.tools', description: 'Self-improving agents.' },
      idempotencyKey: 'idem_2',
    }
    const result = await closeConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe('https://api.close.com/api/v1/lead/')
    expect(call[1]!.method).toBe('POST')
    expect(JSON.parse(String(call[1]!.body))).toEqual({
      name: 'Tangle',
      url: 'https://tangle.tools',
      description: 'Self-improving agents.',
    })
  })

  it('PUTs leads.update at the lead-id path', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 'lead_42', status_id: 'stat_won' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'leads.update',
      args: { leadId: 'lead_42', status_id: 'stat_won' },
      idempotencyKey: 'idem_3',
    }
    const result = await closeConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe('https://api.close.com/api/v1/lead/lead_42/')
    expect(call[1]!.method).toBe('PUT')
    const body = JSON.parse(String(call[1]!.body)) as Record<string, unknown>
    expect(body).toMatchObject({ leadId: 'lead_42', status_id: 'stat_won' })
  })
})
