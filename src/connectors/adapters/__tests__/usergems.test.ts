import { afterEach, describe, expect, it, vi } from 'vitest'
import { usergemsConnector } from '../usergems.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_usergems',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'usergems',
  label: 'UserGems',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'usergems-key' },
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

describe('usergems adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(usergemsConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and sales-intelligence classification', () => {
    expect(usergemsConnector.manifest.kind).toBe('usergems')
    expect(usergemsConnector.manifest.displayName).toBe('UserGems')
    expect(usergemsConnector.manifest.category).toBe('sales-intelligence')
    expect(usergemsConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = usergemsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['accounts.add', 'accounts.delete', 'contacts.add', 'contacts.delete'])
    const reads = usergemsConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = usergemsConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual([])
    expect(mutations).toEqual(['accounts.add', 'accounts.delete', 'contacts.add', 'contacts.delete'])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof usergemsConnector.executeRead).toBe('function')
    expect(typeof usergemsConnector.executeMutation).toBe('function')
  })

  it('declares a CAS strategy for every mutation', () => {
    for (const cap of usergemsConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('routes contacts.delete as DELETE /v1/contact and serializes the identifier into the body', async () => {
    const fetchMock = mockFetch({ message: 'Contact deleted' })
    const result = await usergemsConnector.executeMutation!({ source, capabilityName: 'contacts.delete', args: {"email":"noop-connector-test@example.com"}, idempotencyKey: 'op_0' })
    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/contact')
    expect(init.method).toBe('DELETE')
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('usergems-key')
    // UserGems takes the delete identifier in the DELETE body (verified against
    // the official `curl -X DELETE -d '{"email":...}'` docs); the runtime must
    // therefore send a body on DELETE when the op declares one. Optional
    // relationshipType/signal are absent, so they must be omitted, not throw.
    expect(JSON.parse(init.body as string)).toEqual({ email: 'noop-connector-test@example.com' })
  })

  it('omits optional body fields when only required args are supplied', async () => {
    const fetchMock = mockFetch({ message: 'Contact added to queue' })
    await usergemsConnector.executeMutation!({ source, capabilityName: 'contacts.add', args: { email: 'a@b.com' }, idempotencyKey: 'add_1' })
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    // firstName/lastName/company/... are optional per the schema and were not
    // supplied: the body must contain only email — not throw "missing required
    // argument: firstName" (the systemic per-field-body bug this fixes).
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.com' })
  })

  it('throws CredentialsExpired when UserGems rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      usergemsConnector.executeMutation!({ source, capabilityName: 'contacts.delete', args: {"email":"noop-connector-test@example.com"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      usergemsConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
