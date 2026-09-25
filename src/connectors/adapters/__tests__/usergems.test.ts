import { afterEach, describe, expect, it, vi } from 'vitest'
import { usergemsConnector } from '../usergems.js'
import { type ResolvedDataSource } from '../../types.js'

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
})
