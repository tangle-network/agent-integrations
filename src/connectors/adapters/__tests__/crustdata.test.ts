import { afterEach, describe, expect, it, vi } from 'vitest'
import { crustdataConnector } from '../crustdata.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_crustdata',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'crustdata',
  label: 'Crustdata',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'crustdata-key' },
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

describe('crustdata adapter', () => {
  it('routes person.enrich as POST /person/enrich', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await crustdataConnector.executeRead!({ source, capabilityName: 'person.enrich', args: {"professional_network_profile_urls":["https://www.linkedin.com/in/abhilashchowdhary"],"business_emails":["x"],"fields":["x"]}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/person/enrich')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer crustdata-key')
    expect(JSON.parse(String(init.body))).toEqual({"professional_network_profile_urls":["https://www.linkedin.com/in/abhilashchowdhary"],"business_emails":["x"],"fields":["x"]})
  })

  it('throws CredentialsExpired when Crustdata rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      crustdataConnector.executeRead!({ source, capabilityName: 'person.enrich', args: {"professional_network_profile_urls":["https://www.linkedin.com/in/abhilashchowdhary"],"business_emails":["x"],"fields":["x"]}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      crustdataConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
