import { afterEach, describe, expect, it, vi } from 'vitest'
import { whatConvertsConnector } from '../src/connectors/adapters/what-converts.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_what_converts_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'what-converts',
    label: 'what-converts test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'wc_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('what-converts adapter manifest', () => {
  it('classifies itself as the crm category and exposes the what-converts kind', () => {
    expect(whatConvertsConnector.manifest.kind).toBe('what-converts')
    expect(whatConvertsConnector.manifest.category).toBe('crm')
    expect(whatConvertsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = whatConvertsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set plus write-side delete/qualify and the accounts + users reads', () => {
    const names = whatConvertsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'leads.create',
        'leads.delete',
        'leads.getByEmail',
        'leads.list',
        'leads.qualify',
        'leads.update',
        'accounts.list',
        'users.list',
      ].sort(),
    )
    const mutations = whatConvertsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['leads.create', 'leads.delete', 'leads.qualify', 'leads.update'])
    const reads = whatConvertsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['accounts.list', 'leads.getByEmail', 'leads.list', 'users.list'])
  })

  it('marks every new write-side mutation as native-idempotency externalEffect', () => {
    const expectedExternal = new Set(['leads.delete', 'leads.qualify'])
    for (const c of whatConvertsConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      if (!expectedExternal.has(c.name)) continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('what-converts leads.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/leads/{lead_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    }))

    const result = await whatConvertsConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.delete',
      args: { lead_id: 'lead_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v1/leads/lead_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      whatConvertsConnector.executeMutation!({
        source: source(),
        capabilityName: 'leads.delete',
        args: { lead_id: 'lead_42' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('what-converts leads.qualify', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /api/v1/leads/{lead_id} with the qualify fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ lead_id: 'lead_42' })
    }))

    await whatConvertsConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.qualify',
      args: { lead_id: 'lead_42', quotable: 'yes', quote_value: 1200 },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/api/v1/leads/lead_42')
    expect(requestBody).toMatchObject({ quotable: 'yes', quote_value: 1200 })
  })
})

describe('what-converts accounts.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/v1/accounts', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ accounts: [] })
    }))

    await whatConvertsConnector.executeRead!({
      source: source(),
      capabilityName: 'accounts.list',
      args: {},
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/api/v1/accounts')
  })
})

describe('what-converts users.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /api/v1/users', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ users: [] })
    }))

    await whatConvertsConnector.executeRead!({
      source: source(),
      capabilityName: 'users.list',
      args: {},
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/api/v1/users')
  })
})
