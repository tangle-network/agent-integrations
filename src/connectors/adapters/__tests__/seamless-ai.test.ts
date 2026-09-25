import { afterEach, describe, expect, it, vi } from 'vitest'
import { seamlessAiConnector } from '../seamless-ai.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_seamless_ai',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'seamless-ai',
  label: 'Seamless.ai',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'seamless-ai-key' },
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

describe('seamless-ai adapter', () => {
  it('routes contacts.search as POST /api/client/v1/search/contacts', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await seamlessAiConnector.executeRead!({ source, capabilityName: 'contacts.search', args: {"jobTitle":["VP of Sales"],"limit":10,"seniority":["x"],"companyDomain":["x"],"industry":["x"],"nextToken":"x"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/api/client/v1/search/contacts')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Token']).toBe('seamless-ai-key')
    expect(JSON.parse(String(init.body))).toEqual({"jobTitle":["VP of Sales"],"seniority":["x"],"companyDomain":["x"],"industry":["x"],"limit":10,"nextToken":"x"})
  })

  it('throws CredentialsExpired when Seamless.ai rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      seamlessAiConnector.executeRead!({ source, capabilityName: 'contacts.search', args: {"jobTitle":["VP of Sales"],"limit":10,"seniority":["x"],"companyDomain":["x"],"industry":["x"],"nextToken":"x"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      seamlessAiConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
