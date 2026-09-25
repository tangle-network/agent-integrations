import { afterEach, describe, expect, it, vi } from 'vitest'
import { autoboundConnector } from '../autobound.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_autobound',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'autobound',
  label: 'Autobound',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'autobound-key' },
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

describe('autobound adapter', () => {
  it('routes account.get as GET /v1/account', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await autoboundConnector.executeRead!({ source, capabilityName: 'account.get', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/account')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('autobound-key')
  })

  it('throws CredentialsExpired when Autobound rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      autoboundConnector.executeRead!({ source, capabilityName: 'account.get', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      autoboundConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
