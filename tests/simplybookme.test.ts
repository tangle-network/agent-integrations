import { afterEach, describe, expect, it, vi } from 'vitest'
import { simplybookmeConnector } from '../src/connectors/adapters/simplybookme.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_simplybookme_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'simplybookme',
    label: 'simplybookme test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { companyLogin: 'https://user-api.simplybook.me' },
    credentials: { kind: 'api-key', apiKey: 'simplybookme_secret' },
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

describe('simplybookme adapter manifest', () => {
  it('classifies itself as the other category and exposes the simplybookme kind', () => {
    expect(simplybookmeConnector.manifest.kind).toBe('simplybookme')
    expect(simplybookmeConnector.manifest.category).toBe('other')
    expect(simplybookmeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a SimplyBook.me-specific hint', () => {
    const auth = simplybookmeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SimplyBook/i)
  })

  it('covers bookings, clients, invoices, services, providers, and notes capability surface', () => {
    const names = simplybookmeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('bookings.create')
    expect(names).toContain('bookings.find')
    expect(names).toContain('bookings.cancel')
    expect(names).toContain('bookings.confirm')
    expect(names).toContain('bookings.addComment')
    expect(names).toContain('clients.create')
    expect(names).toContain('clients.find')
    expect(names).toContain('clients.delete')
    expect(names).toContain('clients.update')
    expect(names).toContain('services.list')
    expect(names).toContain('providers.list')
    expect(names).toContain('invoices.find')
    expect(names).toContain('notes.create')
  })

  it('marks destructive operations as mutations', () => {
    const mutations = simplybookmeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('bookings.create')
    expect(mutations).toContain('bookings.cancel')
    expect(mutations).toContain('bookings.confirm')
    expect(mutations).toContain('bookings.addComment')
    expect(mutations).toContain('clients.create')
    expect(mutations).toContain('clients.delete')
    expect(mutations).toContain('clients.update')
    expect(mutations).toContain('notes.create')
  })

  it('marks read-only operations as read', () => {
    const reads = simplybookmeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('bookings.find')
    expect(reads).toContain('clients.find')
    expect(reads).toContain('invoices.find')
    expect(reads).toContain('services.list')
    expect(reads).toContain('providers.list')
  })

  it('marks all mutations as native-idempotency or optimistic-read-verify with external effect', () => {
    const mutations = simplybookmeConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const m of mutations) {
      if (m.class !== 'mutation') continue
      expect(['native-idempotency', 'optimistic-read-verify']).toContain(m.cas)
      expect(m.externalEffect).toBe(true)
    }
  })
})

describe('simplybookme clients.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a PUT to /admin/clients/{clientId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string | undefined
      return jsonResponse({ id: 42 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await simplybookmeConnector.executeMutation!({
      source: source(),
      capabilityName: 'clients.update',
      args: { clientId: 42, name: 'Updated Name', email: 'u@example.com' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/admin/clients/42')
    expect(requestBody ?? '').toContain('Updated Name')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      simplybookmeConnector.executeMutation!({
        source: source(),
        capabilityName: 'clients.update',
        args: { clientId: 42 },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('simplybookme bookings.confirm', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a POST to /admin/bookings/{bookingId}/approve', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await simplybookmeConnector.executeMutation!({
      source: source(),
      capabilityName: 'bookings.confirm',
      args: { bookingId: 7 },
      idempotencyKey: 'k-c1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/admin/bookings/7/approve')
  })
})

describe('simplybookme services.list and providers.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a GET to /admin/services', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse([{ id: 1 }])
      }),
    )

    await simplybookmeConnector.executeRead!({
      source: source(),
      capabilityName: 'services.list',
      args: { limit: 50 },
      idempotencyKey: 'k-s',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/admin/services')
    expect(String(requestUrl)).toContain('limit=50')
  })

  it('issues a GET to /admin/providers', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return jsonResponse([{ id: 2 }])
      }),
    )

    await simplybookmeConnector.executeRead!({
      source: source(),
      capabilityName: 'providers.list',
      args: {},
      idempotencyKey: 'k-p',
    })

    expect(String(requestUrl)).toContain('/admin/providers')
  })
})
