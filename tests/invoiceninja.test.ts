import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoiceninjaConnector } from '../src/connectors/adapters/invoiceninja.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(baseUrl: string): ResolvedDataSource {
  return {
    id: 'src_invoiceninja_1',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'invoiceninja',
    label: 'Invoice Ninja test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl },
    credentials: { kind: 'api-key', apiKey: 'ninja-secret' },
    status: 'active',
  }
}

describe('invoiceninja adapter manifest', () => {
  it('classifies itself as the crm category and exposes the invoiceninja kind', () => {
    expect(invoiceninjaConnector.manifest.kind).toBe('invoiceninja')
    expect(invoiceninjaConnector.manifest.category).toBe('crm')
    expect(invoiceninjaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = invoiceninjaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (clients, invoices, recurring, tasks, reports)', () => {
    const names = invoiceninjaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'clients.create',
        'clients.get',
        'invoices.create',
        'invoices.list',
        'recurring_invoices.create',
        'recurring_invoices.action',
        'tasks.create',
        'tasks.exists',
        'reports.get',
      ].sort(),
    )
    const reads = invoiceninjaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = invoiceninjaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['clients.get', 'invoices.list', 'reports.get', 'tasks.exists'].sort())
    expect(mutations).toEqual(
      [
        'clients.create',
        'invoices.create',
        'recurring_invoices.action',
        'recurring_invoices.create',
        'tasks.create',
      ].sort(),
    )
  })
})

describe('invoiceninja tenant endpoint boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('allows a public HTTPS self-host and places the token only in X-API-TOKEN', async () => {
    let url = ''
    let headers = new Headers()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      headers = new Headers(init?.headers)
      return new Response(JSON.stringify({ data: [] }), {
        headers: { 'content-type': 'application/json' },
      })
    }))

    await invoiceninjaConnector.executeRead!({
      source: source('https://invoices.example.com'),
      capabilityName: 'clients.get',
      args: { email: 'billing@example.com' },
      idempotencyKey: 'read_1',
    })

    expect(url).toBe('https://invoices.example.com/api/v1/clients?email=billing%40example.com')
    expect(headers.get('X-API-TOKEN')).toBe('ninja-secret')
    expect(url).not.toContain('ninja-secret')
  })

  it.each([
    'http://invoices.example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.8',
    'https://invoice.internal',
  ])('rejects non-public self-host endpoint %s before sending credentials', async (baseUrl) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(invoiceninjaConnector.executeRead!({
      source: source(baseUrl),
      capabilityName: 'clients.get',
      args: { email: 'billing@example.com' },
      idempotencyKey: 'read_2',
    })).rejects.toThrow('public HTTPS endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
