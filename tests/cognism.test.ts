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
})
