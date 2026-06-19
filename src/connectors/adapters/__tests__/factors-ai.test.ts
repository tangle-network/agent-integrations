import { afterEach, describe, expect, it, vi } from 'vitest'
import { factorsAiConnector } from '../factors-ai.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_factors_ai',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'factors-ai',
  label: 'Factors.ai',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'factors-ai-key' },
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

describe('factors-ai adapter', () => {
  it('ships a valid connector manifest', () => {
    expect(validateConnectorManifest(factorsAiConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and sales-intelligence classification', () => {
    expect(factorsAiConnector.manifest.kind).toBe('factors-ai')
    expect(factorsAiConnector.manifest.displayName).toBe('Factors.ai')
    expect(factorsAiConnector.manifest.category).toBe('sales-intelligence')
    expect(factorsAiConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes the expected capability surface and read/mutation split', () => {
    const allNames = factorsAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(allNames).toEqual(['account.journey'])
    const reads = factorsAiConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = factorsAiConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['account.journey'])
    expect(mutations).toEqual([])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof factorsAiConnector.executeRead).toBe('function')
    expect(typeof factorsAiConnector.executeMutation).toBe('function')
  })

  it('routes account.journey as GET /open/v1/account/factors.ai/journey', async () => {
    const fetchMock = mockFetch({ ok: true })
    const result = await factorsAiConnector.executeRead!({ source, capabilityName: 'account.journey', args: {"account_domain":"factors.ai","from":"2026-06-01","to":"2026-06-18"}, idempotencyKey: 'op_0' })
    expect(result).toBeDefined()
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/open/v1/account/factors.ai/journey')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer factors-ai-key')
    expect(url.searchParams.get('from')).toBe('2026-06-01')
    expect(url.searchParams.get('to')).toBe('2026-06-18')
  })

  it('throws CredentialsExpired when Factors.ai rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      factorsAiConnector.executeRead!({ source, capabilityName: 'account.journey', args: {"account_domain":"factors.ai","from":"2026-06-01","to":"2026-06-18"}, idempotencyKey: 'unauth_1' }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('rejects unknown capabilities', async () => {
    await expect(
      factorsAiConnector.executeRead!({ source, capabilityName: 'does.not.exist', args: {}, idempotencyKey: 'unknown_1' }),
    ).rejects.toThrow(/unknown read capability/)
  })
})
