import { afterEach, describe, expect, it, vi } from 'vitest'
import { zendeskSellConnector } from '../src/connectors/adapters/zendesk-sell.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_zendesk_sell_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'zendesk-sell',
    label: 'zendesk-sell test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'zendesk_sell_secret' },
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

describe('zendesk-sell adapter manifest', () => {
  it('classifies itself as the crm category and exposes the zendesk-sell kind', () => {
    expect(zendeskSellConnector.manifest.kind).toBe('zendesk-sell')
    expect(zendeskSellConnector.manifest.category).toBe('crm')
    expect(zendeskSellConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = zendeskSellConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Zendesk/i)
  })

  it('covers contact, lead, deal, note, and task capability surface including write-side extensions', () => {
    const names = zendeskSellConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.create',
        'contacts.find',
        'contacts.update',
        'contacts.delete',
        'deals.create',
        'deals.find',
        'deals.update',
        'deals.delete',
        'leads.create',
        'leads.find',
        'leads.update',
        'leads.delete',
        'notes.create',
        'tasks.create',
      ].sort(),
    )
    const mutations = zendeskSellConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'contacts.create',
        'contacts.update',
        'contacts.delete',
        'deals.create',
        'deals.update',
        'deals.delete',
        'leads.create',
        'leads.update',
        'leads.delete',
        'notes.create',
        'tasks.create',
      ].sort(),
    )
  })

  it('marks every new write-side mutation as native-idempotency externalEffect', () => {
    const expectedExternal = new Set([
      'contacts.delete',
      'leads.update',
      'leads.delete',
      'deals.delete',
      'tasks.create',
    ])
    const caps = zendeskSellConnector.manifest.capabilities
    for (const c of caps) {
      if (c.class !== 'mutation') continue
      if (!expectedExternal.has(c.name)) continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('zendesk-sell contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v2/contact/{contactId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zendeskSellConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { contactId: 'c_77' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v2/contact/c_77')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      zendeskSellConnector.executeMutation!({
        source: source(),
        capabilityName: 'contacts.delete',
        args: { contactId: 'c_77' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('zendesk-sell leads.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /v2/lead/{leadId} with the merged args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'lead_5' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await zendeskSellConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.update',
      args: { leadId: 'lead_5', status: 'qualified', email: 'a@b.com' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/v2/lead/lead_5')
    expect(requestBody).toMatchObject({ leadId: 'lead_5', status: 'qualified', email: 'a@b.com' })
  })
})

describe('zendesk-sell leads.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v2/lead/{leadId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await zendeskSellConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.delete',
      args: { leadId: 'lead_5' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v2/lead/lead_5')
  })
})

describe('zendesk-sell deals.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v2/deal/{dealId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await zendeskSellConnector.executeMutation!({
      source: source(),
      capabilityName: 'deals.delete',
      args: { dealId: 'deal_8' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v2/deal/deal_8')
  })
})

describe('zendesk-sell tasks.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/task with the args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'task_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zendeskSellConnector.executeMutation!({
      source: source(),
      capabilityName: 'tasks.create',
      args: { title: 'Follow up', dueDate: '2026-07-01', resourceType: 'contact', resourceId: 'c_77' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v2/task')
    expect(requestBody).toMatchObject({
      title: 'Follow up',
      dueDate: '2026-07-01',
      resourceType: 'contact',
      resourceId: 'c_77',
    })
    expect(result.status).toBe('committed')
  })
})
