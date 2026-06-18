import { afterEach, describe, expect, it, vi } from 'vitest'
import { cognismConnector } from '../src/connectors/adapters/cognism.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_cognism_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'cognism',
    label: 'Drew Cognism',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'cognism-test-token' },
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

const EXPECTED = [
  'contact.search',
  'contact.enrich',
  'contact.redeem',
  'account.search',
  'account.enrich',
  'account.redeem',
]

describe('cognism adapter manifest', () => {
  it('classifies itself as sales-intelligence with api-key auth', () => {
    expect(cognismConnector.manifest.kind).toBe('cognism')
    expect(cognismConnector.manifest.category).toBe('sales-intelligence')
    expect(cognismConnector.manifest.auth.kind).toBe('api-key')
  })

  it('splits free search/enrich reads from the credit-consuming contact.redeem mutation', () => {
    const names = cognismConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([...EXPECTED].sort())

    const reads = cognismConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = cognismConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads).toEqual(['account.enrich', 'account.redeem', 'account.search', 'contact.enrich', 'contact.search'].sort())
    expect(mutations).toEqual(['contact.redeem'])

    const redeem = cognismConnector.manifest.capabilities.find((c) => c.name === 'contact.redeem')
    if (!redeem || redeem.class !== 'mutation') throw new Error('contact.redeem must be a mutation')
    expect(redeem.cas).toBe('native-idempotency')
    expect(redeem.externalEffect).toBe(true)
  })
})

describe('cognism execution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the search filter object as the body with the bearer token and pagination query', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: unknown = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedHeaders = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ records: [{ redeemId: 'r1', hasEmail: true }] })
    }))

    const result = await cognismConnector.executeRead!({
      source: source(),
      capabilityName: 'contact.search',
      args: { filters: { jobTitles: ['CTO'], countries: ['US'] }, indexSize: 50 },
      idempotencyKey: 'k',
    })

    expect(capturedMethod).toBe('POST')
    const url = new URL(capturedUrl)
    expect(url.origin).toBe('https://app.cognism.com')
    expect(url.pathname).toBe('/api/search/contact/search')
    expect(url.searchParams.get('indexSize')).toBe('50')
    expect(capturedHeaders['authorization']).toBe('Bearer cognism-test-token')
    // The whole filter object becomes the body — pagination stays in the query.
    expect(capturedBody).toEqual({ jobTitles: ['CTO'], countries: ['US'] })
    expect(result.data).toMatchObject({ records: [{ redeemId: 'r1' }] })
  })

  it('redeems contacts as a committed mutation carrying the redeemIds body', async () => {
    let capturedBody: unknown = null
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ contacts: [{ id: 'r1', email: 'jane@acme.com' }] })
    }))

    const result = await cognismConnector.executeMutation!({
      source: source(),
      capabilityName: 'contact.redeem',
      args: { redeemIds: ['r1', 'r2'] },
      idempotencyKey: 'k',
    })

    expect(capturedBody).toEqual({ redeemIds: ['r1', 'r2'] })
    expect(result.status).toBe('committed')
  })

  it('rejects contact.redeem when redeemIds is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      cognismConnector.executeMutation!({
        source: source(),
        capabilityName: 'contact.redeem',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/redeemIds/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } })))
    await expect(
      cognismConnector.executeRead!({
        source: source(),
        capabilityName: 'contact.search',
        args: { filters: {} },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })))
    await expect(
      cognismConnector.executeRead!({
        source: source(),
        capabilityName: 'contact.search',
        args: { filters: {} },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
