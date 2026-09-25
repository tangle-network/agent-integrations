import { afterEach, describe, expect, it, vi } from 'vitest'
import { lagrowthmachineConnector } from '../lagrowthmachine.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_lagrowthmachine',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'lagrowthmachine',
  label: 'LaGrowthMachine',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'lagrowthmachine-key' },
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

describe('lagrowthmachine adapter', () => {
  it('routes campaigns.list as GET /flow/campaigns', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await lagrowthmachineConnector.executeRead!({ source, capabilityName: 'campaigns.list', args: {"skip":0,"limit":25}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/flow/campaigns')
    expect(init.method).toBe('GET')
    expect(url.searchParams.get('apikey')).toBe('lagrowthmachine-key')
    expect(url.searchParams.get('skip')).toBe('0')
    expect(url.searchParams.get('limit')).toBe('25')
  })

  it('throws CredentialsExpired when LaGrowthMachine rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      lagrowthmachineConnector.executeRead!({ source, capabilityName: 'campaigns.list', args: {"skip":0,"limit":25}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      lagrowthmachineConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
