import { afterEach, describe, expect, it, vi } from 'vitest'
import { contactoutConnector } from '../contactout.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_contactout',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'contactout',
  label: 'ContactOut',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'contactout-key' },
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

describe('contactout adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(contactoutConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and crm classification', () => {
    expect(contactoutConnector.manifest.kind).toBe('contactout')
    expect(contactoutConnector.manifest.displayName).toBe('ContactOut')
    expect(contactoutConnector.manifest.category).toBe('crm')
    expect(contactoutConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = contactoutConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['email.verify', 'linkedin.enrich', 'people.enrich', 'people.search'])
    const reads = contactoutConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = contactoutConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['people.search'])
    expect(mutations).toEqual(['email.verify', 'linkedin.enrich', 'people.enrich'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof contactoutConnector.executeRead).toBe('function')
    expect(typeof contactoutConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of contactoutConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes linkedin.enrich as GET /v1/linkedin/enrich', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await contactoutConnector.executeMutation!({ source, capabilityName: 'linkedin.enrich', args: {"profile":"https://www.linkedin.com/in/williamhgates"}, idempotencyKey: 'op_0' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/linkedin/enrich')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['token']).toBe('contactout-key')
    expect(url.searchParams.get('profile')).toBe('https://www.linkedin.com/in/williamhgates')
  })

  it('routes email.verify as GET /v1/email/verify', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await contactoutConnector.executeMutation!({ source, capabilityName: 'email.verify', args: {"email":"ada@stripe.com"}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/email/verify')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['token']).toBe('contactout-key')
    expect(url.searchParams.get('email')).toBe('ada@stripe.com')
  })

  it('throws CredentialsExpired when ContactOut rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      contactoutConnector.executeMutation!({ source, capabilityName: 'linkedin.enrich', args: {"profile":"https://www.linkedin.com/in/williamhgates"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      contactoutConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
