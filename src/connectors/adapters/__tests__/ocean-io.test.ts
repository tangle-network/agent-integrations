import { afterEach, describe, expect, it, vi } from 'vitest'
import { oceanIoConnector } from '../ocean-io.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_ocean_io',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'ocean-io',
  label: 'Ocean.io',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'ocean-io-key' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('ocean-io adapter', () => {
  it('routes companies.autocomplete as POST /v2/autocomplete/companies', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await oceanIoConnector.executeRead!({ source, capabilityName: 'companies.autocomplete', args: {"name":"stripe"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/autocomplete/companies')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Api-Token']).toBe('ocean-io-key')
    expect(JSON.parse(String(init.body))).toEqual({"name":"stripe"})
  })

  it('throws CredentialsExpired when Ocean.io rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      oceanIoConnector.executeRead!({ source, capabilityName: 'companies.autocomplete', args: {"name":"stripe"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      oceanIoConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
