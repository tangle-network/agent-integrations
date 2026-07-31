import { afterEach, describe, expect, it, vi } from 'vitest'
import { baserowConnector } from '../src/connectors/adapters/baserow.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_baserow_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'baserow',
    label: 'Baserow test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'database-token-secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Baserow adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exposes only database-token-supported table, field, and row operations', () => {
    expect(baserowConnector.manifest).toMatchObject({
      kind: 'baserow',
      category: 'database',
      defaultConsistencyModel: 'authoritative',
      auth: { kind: 'api-key' },
    })
    expect(baserowConnector.manifest.capabilities.map((capability) => capability.name).sort()).toEqual([
      'fields.create',
      'fields.list',
      'rows.batch-create',
      'rows.batch-delete',
      'rows.batch-update',
      'rows.create',
      'rows.delete',
      'rows.get',
      'rows.list',
      'rows.move',
      'rows.update',
      'tables.list',
    ])
  })

  it('checks database tokens with Baserow Token authorization', async () => {
    let capturedUrl = ''
    let capturedAuthorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedAuthorization = new Headers(init?.headers).get('authorization') ?? ''
      return new Response(null, { status: 200 })
    }))

    await expect(baserowConnector.test!(source())).resolves.toEqual({ ok: true })
    expect(capturedUrl).toBe('https://api.baserow.io/api/database/tokens/check/')
    expect(capturedAuthorization).toBe('Token database-token-secret')
  })

  it('lists every table granted to the database token', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse([{ id: 41, name: 'Customers' }])
    }))

    const result = await baserowConnector.executeRead!({
      source: source(),
      capabilityName: 'tables.list',
      args: {},
      idempotencyKey: 'list-tables',
    })

    expect(capturedUrl).toBe('https://api.baserow.io/api/database/tables/all-tables/')
    expect(result.data).toEqual([{ id: 41, name: 'Customers' }])
  })

  it('renders row list filters and always requests user field names', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ count: 1, results: [{ id: 7, Name: 'Ada' }] })
    }))

    await baserowConnector.executeRead!({
      source: source(),
      capabilityName: 'rows.list',
      args: {
        tableId: 41,
        page: 2,
        size: 50,
        search: 'Ada',
        orderBy: '-Created',
        filters: '{"filter_type":"AND","filters":[]}',
      },
      idempotencyKey: 'list-rows',
    })

    const url = new URL(capturedUrl)
    expect(url.pathname).toBe('/api/database/rows/table/41/')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      user_field_names: 'true',
      page: '2',
      size: '50',
      search: 'Ada',
      order_by: '-Created',
      filters: '{"filter_type":"AND","filters":[]}',
    })
  })

  it('creates a row without leaking optional query placeholders', async () => {
    let capturedUrl = ''
    let capturedBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ id: 7, Name: 'Ada' })
    }))

    const result = await baserowConnector.executeMutation!({
      source: source(),
      capabilityName: 'rows.create',
      args: { tableId: 41, fields: { Name: 'Ada' } },
      idempotencyKey: 'create-row',
    })

    expect(capturedUrl).toBe('https://api.baserow.io/api/database/rows/table/41/?user_field_names=true')
    expect(capturedBody).toEqual({ Name: 'Ada' })
    expect(result.status).toBe('committed')
  })

  it('updates and batch deletes rows with provider-native request shapes', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? '',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return jsonResponse({ ok: true })
    }))

    await baserowConnector.executeMutation!({
      source: source(),
      capabilityName: 'rows.update',
      args: { tableId: 41, rowId: 7, fields: { Status: 'Qualified' }, sendWebhookEvents: false },
      idempotencyKey: 'update-row',
    })
    await baserowConnector.executeMutation!({
      source: source(),
      capabilityName: 'rows.batch-delete',
      args: { tableId: 41, rowIds: [7, 8], sendWebhookEvents: true },
      idempotencyKey: 'delete-rows',
    })

    expect(requests).toEqual([
      {
        url: 'https://api.baserow.io/api/database/rows/table/41/7/?user_field_names=true&send_webhook_events=false',
        method: 'PATCH',
        body: { Status: 'Qualified' },
      },
      {
        url: 'https://api.baserow.io/api/database/rows/table/41/batch-delete/?send_webhook_events=true',
        method: 'POST',
        body: { items: [7, 8] },
      },
    ])
  })

  it('supports a public HTTPS self-hosted API root and rejects private targets', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse([])
    }))

    await baserowConnector.executeRead!({
      source: source({ metadata: { baseUrl: 'https://baserow.example.com/api-root' } }),
      capabilityName: 'tables.list',
      args: {},
      idempotencyKey: 'self-hosted',
    })
    expect(capturedUrl).toBe('https://baserow.example.com/api-root/api/database/tables/all-tables/')

    await expect(baserowConnector.executeRead!({
      source: source({ metadata: { baseUrl: 'http://127.0.0.1:8080' } }),
      capabilityName: 'tables.list',
      args: {},
      idempotencyKey: 'private-host',
    })).rejects.toThrow(/public HTTPS endpoint/)
  })

  it('redacts the database token from provider error text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'request rejected for Token database-token-secret',
      { status: 500 },
    )))

    await expect(baserowConnector.executeRead!({
      source: source(),
      capabilityName: 'tables.list',
      args: {},
      idempotencyKey: 'redaction',
    })).rejects.not.toThrow(/database-token-secret/)
  })
})
