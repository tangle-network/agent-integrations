import { afterEach, describe, expect, it, vi } from 'vitest'
import { wizaConnector } from '../wiza.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_wiza',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'wiza',
  label: 'Wiza',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'wiza-key' },
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

describe('wiza adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(wizaConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and crm classification', () => {
    expect(wizaConnector.manifest.kind).toBe('wiza')
    expect(wizaConnector.manifest.displayName).toBe('Wiza')
    expect(wizaConnector.manifest.category).toBe('crm')
    expect(wizaConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = wizaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['credits.get', 'individual_reveal.create', 'individual_reveal.get', 'list.create'])
    const reads = wizaConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = wizaConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['credits.get', 'individual_reveal.get'])
    expect(mutations).toEqual(['individual_reveal.create', 'list.create'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof wizaConnector.executeRead).toBe('function')
    expect(typeof wizaConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of wizaConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes credits.get as GET /api/meta/credits', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await wizaConnector.executeRead!({ source, capabilityName: 'credits.get', args: {}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/meta/credits')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer wiza-key')
  })

  it('routes individual_reveal.create as POST /api/individual_reveals', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await wizaConnector.executeMutation!({ source, capabilityName: 'individual_reveal.create', args: {"individual_reveal":{"full_name":"Stephen Hakami","company":"Wiza","domain":"wiza.co"},"enrichment_level":"partial","email_options":{"accept_work":true,"accept_personal":false},"phone_options":{}}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/individual_reveals')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer wiza-key')
    expect(JSON.parse(String(init.body))).toEqual({"individual_reveal":{"full_name":"Stephen Hakami","company":"Wiza","domain":"wiza.co"},"enrichment_level":"partial","email_options":{"accept_work":true,"accept_personal":false},"phone_options":{}})
  })

  it('throws CredentialsExpired when Wiza rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      wizaConnector.executeRead!({ source, capabilityName: 'credits.get', args: {}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      wizaConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
