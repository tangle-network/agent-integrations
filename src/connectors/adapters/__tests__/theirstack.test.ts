import { afterEach, describe, expect, it, vi } from 'vitest'
import { theirstackConnector } from '../theirstack.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_theirstack',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'theirstack',
  label: 'TheirStack',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'theirstack-key' },
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

describe('theirstack adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(theirstackConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and sales-intelligence classification', () => {
    expect(theirstackConnector.manifest.kind).toBe('theirstack')
    expect(theirstackConnector.manifest.displayName).toBe('TheirStack')
    expect(theirstackConnector.manifest.category).toBe('sales-intelligence')
    expect(theirstackConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = theirstackConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['companies.buying_intents', 'companies.search', 'companies.technologies', 'jobs.search'])
    const reads = theirstackConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = theirstackConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['companies.buying_intents', 'companies.search', 'companies.technologies', 'jobs.search'])
    expect(mutations).toEqual([])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof theirstackConnector.executeRead).toBe('function')
    expect(typeof theirstackConnector.executeMutation).toBe('function')
  })

  it('routes jobs.search as POST /v1/jobs/search', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await theirstackConnector.executeRead!({ source, capabilityName: 'jobs.search', args: {"posted_at_max_age_days":7,"job_title_or":["software engineer"],"limit":5,"page":0,"job_country_code_or":["x"],"company_technology_slug_or":["x"],"company_name_or":["x"]}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v1/jobs/search')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer theirstack-key')
    expect(JSON.parse(String(init.body))).toEqual({"posted_at_max_age_days":7,"job_title_or":["software engineer"],"job_country_code_or":["x"],"company_technology_slug_or":["x"],"company_name_or":["x"],"limit":5,"page":0})
  })

  it('throws CredentialsExpired when TheirStack rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      theirstackConnector.executeRead!({ source, capabilityName: 'jobs.search', args: {"posted_at_max_age_days":7,"job_title_or":["software engineer"],"limit":5,"page":0,"job_country_code_or":["x"],"company_technology_slug_or":["x"],"company_name_or":["x"]}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      theirstackConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
