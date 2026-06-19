import { afterEach, describe, expect, it, vi } from 'vitest'
import { nooksConnector } from '../nooks.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_nooks',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'nooks',
  label: 'Nooks',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'nooks-key' },
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

describe('nooks adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(nooksConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and comms classification', () => {
    expect(nooksConnector.manifest.kind).toBe('nooks')
    expect(nooksConnector.manifest.displayName).toBe('Nooks')
    expect(nooksConnector.manifest.category).toBe('comms')
    expect(nooksConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = nooksConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['accounts.list', 'calls.get', 'calls.list', 'prospects.list', 'prospects.sync'])
    const reads = nooksConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = nooksConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['accounts.list', 'calls.get', 'calls.list', 'prospects.list'])
    expect(mutations).toEqual(['prospects.sync'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof nooksConnector.executeRead).toBe('function')
    expect(typeof nooksConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of nooksConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes accounts.list as GET /v1/accounts', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await nooksConnector.executeRead!({ source, capabilityName: 'accounts.list', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/accounts')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer nooks-key')
  })

  it('throws CredentialsExpired when Nooks rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      nooksConnector.executeRead!({ source, capabilityName: 'accounts.list', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      nooksConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
