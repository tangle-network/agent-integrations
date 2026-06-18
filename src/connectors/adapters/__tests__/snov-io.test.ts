import { afterEach, describe, expect, it, vi } from 'vitest'
import { snovIoConnector } from '../snov-io.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_snov_io',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'snov-io',
  label: 'Snov.io',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'snov-io-key' },
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

describe('snov-io adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(snovIoConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and crm classification', () => {
    expect(snovIoConnector.manifest.kind).toBe('snov-io')
    expect(snovIoConnector.manifest.displayName).toBe('Snov.io')
    expect(snovIoConnector.manifest.category).toBe('crm')
    expect(snovIoConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = snovIoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['domain_emails_count.get', 'domain_search.start', 'email_finder.start', 'email_verification.start', 'profile.get_by_email'])
    const reads = snovIoConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = snovIoConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['domain_emails_count.get'])
    expect(mutations).toEqual(['domain_search.start', 'email_finder.start', 'email_verification.start', 'profile.get_by_email'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof snovIoConnector.executeRead).toBe('function')
    expect(typeof snovIoConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of snovIoConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes domain_emails_count.get as POST /v1/get-domain-emails-count', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await snovIoConnector.executeRead!({ source, capabilityName: 'domain_emails_count.get', args: {"domain":"stripe.com"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/get-domain-emails-count')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer snov-io-key')
    expect(JSON.parse(String(init.body))).toEqual({"domain":"stripe.com"})
  })

  it('routes email_verification.start as POST /v2/email-verification/start', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await snovIoConnector.executeMutation!({ source, capabilityName: 'email_verification.start', args: {"emails":["ada@stripe.com"]}, idempotencyKey: 'op_1' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/email-verification/start')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer snov-io-key')
    expect(JSON.parse(String(init.body))).toEqual({"emails":["ada@stripe.com"]})
  })

  it('throws CredentialsExpired when Snov.io rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      snovIoConnector.executeRead!({ source, capabilityName: 'domain_emails_count.get', args: {"domain":"stripe.com"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      snovIoConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
