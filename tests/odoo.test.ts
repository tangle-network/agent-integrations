import { afterEach, describe, expect, it, vi } from 'vitest'
import { odooConnector } from '../src/connectors/adapters/odoo.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_odoo_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'odoo',
    label: 'Odoo test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { base_url: 'https://odoo.example.com' },
    credentials: { kind: 'api-key', apiKey: 'odoo_secret' },
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

describe('odoo adapter manifest', () => {
  it('classifies itself as the crm category and exposes the odoo kind', () => {
    expect(odooConnector.manifest.kind).toBe('odoo')
    expect(odooConnector.manifest.category).toBe('crm')
    expect(odooConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = odooConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes core record operations and new write-side capabilities', () => {
    const names = odooConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('records.search_read')
    expect(names).toContain('records.get')
    expect(names).toContain('records.create')
    expect(names).toContain('records.update')
    expect(names).toContain('records.delete')
    expect(names).toContain('models.search')
    expect(names).toContain('models.count')
    expect(names).toContain('records.copy')
    expect(names).toContain('records.unlink_batch')
    expect(names).toContain('fields.set')
    expect(names).toContain('workflow.action')
  })

  it('marks new mutations as native-idempotency external effect', () => {
    const newMutations = ['records.copy', 'records.unlink_batch', 'fields.set', 'workflow.action']
    for (const name of newMutations) {
      const cap = odooConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `expected capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('marks read operations as read-only', () => {
    const reads = odooConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('records.search_read')
    expect(reads).toContain('records.get')
    expect(reads).toContain('models.search')
    expect(reads).toContain('models.count')
  })
})

describe('odoo records.copy', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/copy with model + ids', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ id: 42 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await odooConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.copy',
      args: { model: 'res.partner', recordId: 17 },
      idempotencyKey: 'k-copy-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/copy')
    expect(requestBody).toEqual({ model: 'res.partner', ids: [17] })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      odooConnector.executeMutation!({
        source: source(),
        capabilityName: 'records.copy',
        args: { model: 'res.partner', recordId: 17 },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('odoo records.unlink_batch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/unlink with the full id list', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ result: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await odooConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.unlink_batch',
      args: { model: 'res.partner', recordIds: [1, 2, 3] },
      idempotencyKey: 'k-unlink-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/api/v1/unlink')
    expect(requestBody).toEqual({ model: 'res.partner', ids: [1, 2, 3] })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      odooConnector.executeMutation!({
        source: source(),
        capabilityName: 'records.unlink_batch',
        args: { model: 'res.partner', recordIds: [1] },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('odoo fields.set', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/write with the single-field values map', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ result: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await odooConnector.executeMutation!({
      source: source(),
      capabilityName: 'fields.set',
      args: { model: 'res.partner', recordId: 5, values: { name: 'Renamed' } },
      idempotencyKey: 'k-set-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/api/v1/write')
    expect(requestBody).toEqual({ model: 'res.partner', ids: [5], values: { name: 'Renamed' } })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      odooConnector.executeMutation!({
        source: source(),
        capabilityName: 'fields.set',
        args: { model: 'res.partner', recordId: 5, values: { name: 'X' } },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('odoo workflow.action', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/call_method with the action name as the method', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ result: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await odooConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflow.action',
      args: { model: 'sale.order', recordId: 7, action: 'action_confirm' },
      idempotencyKey: 'k-wf-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/api/v1/call_method')
    expect(requestBody).toEqual({ model: 'sale.order', ids: [7], method: 'action_confirm' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      odooConnector.executeMutation!({
        source: source(),
        capabilityName: 'workflow.action',
        args: { model: 'sale.order', recordId: 7, action: 'action_confirm' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
