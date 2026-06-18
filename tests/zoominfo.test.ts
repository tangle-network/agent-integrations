import { afterEach, describe, expect, it, vi } from 'vitest'
import { zoominfoConnector } from '../src/connectors/adapters/zoominfo.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_zoominfo_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'zoominfo',
    label: 'Drew ZoomInfo',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'zi-access-token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/vnd.api+json' },
  })
}

const EXPECTED = [
  'contact.search',
  'company.search',
  'intent.search',
  'scoops.search',
  'news.search',
  'contact.enrich',
  'company.enrich',
  'intent.enrich',
  'scoops.enrich',
  'news.enrich',
  'lookup.data',
  'lookup.search_fields',
  'usage.get',
]

describe('zoominfo adapter manifest', () => {
  it('declares the GTM OAuth2 surface and sales-intelligence category', () => {
    expect(zoominfoConnector.manifest.kind).toBe('zoominfo')
    expect(zoominfoConnector.manifest.category).toBe('sales-intelligence')
    const auth = zoominfoConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('zoominfo auth must be oauth2')
    expect(auth.authorizationUrl).toBe('https://api.zoominfo.com/gtm/oauth/v1/authorize')
    expect(auth.tokenUrl).toBe('https://api.zoominfo.com/gtm/oauth/v1/token')
    expect(auth.scopes).toContain('api:data:contact')
    expect(auth.scopes).toContain('api:data:company')
  })

  it('models search as free reads and credit-consuming enrich as external-effect mutations', () => {
    const names = zoominfoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([...EXPECTED].sort())

    const mutations = zoominfoConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(mutations).toEqual(
      ['company.enrich', 'contact.enrich', 'intent.enrich', 'news.enrich', 'scoops.enrich'].sort(),
    )

    const enrich = zoominfoConnector.manifest.capabilities.find((c) => c.name === 'contact.enrich')
    if (!enrich || enrich.class !== 'mutation') throw new Error('contact.enrich must be a mutation')
    expect(enrich.cas).toBe('native-idempotency')
    expect(enrich.externalEffect).toBe(true)
  })
})

describe('zoominfo execution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs contact.search wrapping criteria under data, with bearer auth and bracketed pagination', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: unknown = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedHeaders = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: [{ id: 'c1' }] })
    }))

    await zoominfoConnector.executeRead!({
      source: source(),
      capabilityName: 'contact.search',
      args: { data: { companyName: 'Acme', jobTitle: ['VP Sales'] }, pageNumber: 2, pageSize: 50 },
      idempotencyKey: 'k',
    })

    expect(capturedMethod).toBe('POST')
    const url = new URL(capturedUrl)
    expect(url.origin).toBe('https://api.zoominfo.com')
    expect(url.pathname).toBe('/gtm/data/v1/contacts/search')
    expect(url.searchParams.get('page[number]')).toBe('2')
    expect(url.searchParams.get('page[size]')).toBe('50')
    expect(capturedHeaders['authorization']).toBe('Bearer zi-access-token')
    expect(capturedBody).toEqual({ data: { companyName: 'Acme', jobTitle: ['VP Sales'] } })
  })

  it('enriches companies as a committed mutation', async () => {
    let capturedBody: unknown = null
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: { result: [{ id: '123' }] } })
    }))

    const result = await zoominfoConnector.executeMutation!({
      source: source(),
      capabilityName: 'company.enrich',
      args: { data: { matchCompanyInput: [{ companyId: '123' }], outputFields: ['id', 'name'] } },
      idempotencyKey: 'k',
    })

    expect(capturedBody).toEqual({ data: { matchCompanyInput: [{ companyId: '123' }], outputFields: ['id', 'name'] } })
    expect(result.status).toBe('committed')
  })

  it('interpolates the path field name and maps filter query keys for lookup.data', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ data: [] })
    }))

    await zoominfoConnector.executeRead!({
      source: source(),
      capabilityName: 'lookup.data',
      args: { fieldName: 'industry', category: 'tech' },
      idempotencyKey: 'k',
    })

    const url = new URL(capturedUrl)
    expect(url.pathname).toBe('/gtm/data/v1/lookup/industry')
    expect(url.searchParams.get('filter[category]')).toBe('tech')
  })

  it('rejects contact.search when the required data body is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      zoominfoConnector.executeRead!({
        source: source(),
        capabilityName: 'contact.search',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/data/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } })))
    await expect(
      zoominfoConnector.executeRead!({
        source: source(),
        capabilityName: 'usage.get',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })))
    await expect(
      zoominfoConnector.executeRead!({
        source: source(),
        capabilityName: 'usage.get',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
