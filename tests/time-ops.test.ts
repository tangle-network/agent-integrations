import { afterEach, describe, expect, it, vi } from 'vitest'
import { timeOpsConnector } from '../src/connectors/adapters/time-ops.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_time-ops_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'time-ops',
    label: 'time-ops test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'timeops_secret' },
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

describe('time-ops adapter manifest', () => {
  it('classifies itself as the other category and exposes the time-ops kind', () => {
    expect(timeOpsConnector.manifest.kind).toBe('time-ops')
    expect(timeOpsConnector.manifest.category).toBe('other')
    expect(timeOpsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a TimeOps-specific hint', () => {
    const auth = timeOpsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/TimeOps/i)
  })

  it('covers customers, projects, registrations, and timers capability surface', () => {
    const names = timeOpsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('customers.create')
    expect(names).toContain('customers.update')
    expect(names).toContain('customers.list')
    expect(names).toContain('projects.create')
    expect(names).toContain('projects.update')
    expect(names).toContain('projects.list')
    expect(names).toContain('registrations.create')
    expect(names).toContain('registrations.update')
    expect(names).toContain('registrations.delete')
    expect(names).toContain('registrations.list')
    expect(names).toContain('timers.start')
    expect(names).toContain('timers.stop')
  })

  it('marks destructive and write operations as mutations', () => {
    const mutations = timeOpsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('customers.create')
    expect(mutations).toContain('customers.update')
    expect(mutations).toContain('projects.create')
    expect(mutations).toContain('projects.update')
    expect(mutations).toContain('registrations.create')
    expect(mutations).toContain('registrations.update')
    expect(mutations).toContain('registrations.delete')
    expect(mutations).toContain('timers.start')
    expect(mutations).toContain('timers.stop')
  })

  it('marks read-only operations as read', () => {
    const reads = timeOpsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('customers.list')
    expect(reads).toContain('projects.list')
    expect(reads).toContain('registrations.list')
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    const mutations = timeOpsConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const cap of mutations) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('time-ops customers.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /customers/{id} with the args body and bearer auth', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    let authHeader: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      const headers = init?.headers as Record<string, string> | undefined
      authHeader = headers?.authorization
      return jsonResponse({ id: 'cust_1', name: 'Acme' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await timeOpsConnector.executeMutation!({
      source: source(),
      capabilityName: 'customers.update',
      args: { id: 'cust_1', name: 'Acme', defaultRate: 120 },
      idempotencyKey: 'k-cust-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.timeops.io/api/v1/customers/cust_1')
    expect(requestBody).toMatchObject({ id: 'cust_1', name: 'Acme', defaultRate: 120 })
    expect(authHeader).toBe('Bearer timeops_secret')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      timeOpsConnector.executeMutation!({
        source: source(),
        capabilityName: 'customers.update',
        args: { id: 'cust_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('time-ops projects.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /projects/{id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'proj_42' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await timeOpsConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.update',
      args: { id: 'proj_42', name: 'Renamed', billable: false },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.timeops.io/api/v1/projects/proj_42')
  })
})

describe('time-ops registrations.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /registrations/{id} with the args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'reg_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await timeOpsConnector.executeMutation!({
      source: source(),
      capabilityName: 'registrations.update',
      args: { id: 'reg_1', description: 'updated text' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.timeops.io/api/v1/registrations/reg_1')
    expect(requestBody).toMatchObject({ description: 'updated text' })
  })
})

describe('time-ops registrations.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /registrations/{id} and tolerates a 204 no-content response', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: BodyInit | null | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await timeOpsConnector.executeMutation!({
      source: source(),
      capabilityName: 'registrations.delete',
      args: { id: 'reg_77' },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.timeops.io/api/v1/registrations/reg_77')
    expect(requestBody).toBeUndefined()
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401 for delete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      timeOpsConnector.executeMutation!({
        source: source(),
        capabilityName: 'registrations.delete',
        args: { id: 'reg_77' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
