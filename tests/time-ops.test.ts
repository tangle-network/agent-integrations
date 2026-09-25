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
  it('declares api-key auth with a TimeOps-specific hint', () => {
    const auth = timeOpsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/TimeOps/i)
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
