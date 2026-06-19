import { afterEach, describe, expect, it, vi } from 'vitest'
import { justcallConnector } from '../justcall.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_justcall',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'justcall',
  label: 'JustCall',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'justcall-key' },
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

describe('justcall adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(justcallConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and comms classification', () => {
    expect(justcallConnector.manifest.kind).toBe('justcall')
    expect(justcallConnector.manifest.displayName).toBe('JustCall')
    expect(justcallConnector.manifest.category).toBe('comms')
    expect(justcallConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = justcallConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['calls.get', 'calls.list', 'contacts.create', 'contacts.list', 'sms.send'])
    const reads = justcallConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = justcallConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['calls.get', 'calls.list', 'contacts.list'])
    expect(mutations).toEqual(['contacts.create', 'sms.send'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof justcallConnector.executeRead).toBe('function')
    expect(typeof justcallConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of justcallConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes calls.list as GET /v2.1/calls', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await justcallConnector.executeRead!({ source, capabilityName: 'calls.list', args: {"per_page":20}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2.1/calls')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('justcall-key')
    expect(url.searchParams.get('per_page')).toBe('20')
  })

  it('routes sms.send as POST /v2.1/texts/new', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await justcallConnector.executeMutation!({ source, capabilityName: 'sms.send', args: {"justcall_number":"+14155550100","contact_number":"+14155550111","body":"Hello from JustCall","media_url":"x"}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2.1/texts/new')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('justcall-key')
    expect(JSON.parse(String(init.body))).toEqual({"justcall_number":"+14155550100","contact_number":"+14155550111","body":"Hello from JustCall","media_url":"x"})
  })

  it('throws CredentialsExpired when JustCall rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      justcallConnector.executeRead!({ source, capabilityName: 'calls.list', args: {"per_page":20}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      justcallConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
