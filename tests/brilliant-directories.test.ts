import { afterEach, describe, expect, it, vi } from 'vitest'
import { brilliantDirectoriesConnector } from '../src/connectors/adapters/brilliant-directories.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bd_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'brilliant-directories',
    label: 'BD test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { siteUrl: 'https://example.com/api' },
    credentials: { kind: 'api-key', apiKey: 'bd-secret' },
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

describe('brilliant-directories users.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v2/user/update with the user_id payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ user_id: 'u-1', updated: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await brilliantDirectoriesConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.update',
      args: {
        userId: 'u-1',
        email: 'a@b.test',
        subscription_id: 'sub-1',
        meta: { city: 'NYC' },
      },
      idempotencyKey: 'k-update-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('https://example.com/api/v2/user/update')
    expect(requestBody).toMatchObject({ user_id: 'u-1', email: 'a@b.test' })
    expect(result.status).toBe('committed')
  })

  it('rejects when userId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      brilliantDirectoriesConnector.executeMutation!({
        source: source(),
        capabilityName: 'users.update',
        args: { email: 'a@b.test' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/userId/)
  })
})

describe('brilliant-directories users.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v2/user/delete with the user_id', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await brilliantDirectoriesConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.delete',
      args: { userId: 'u-9' },
      idempotencyKey: 'k-delete-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('https://example.com/api/v2/user/delete')
    expect(requestBody).toMatchObject({ user_id: 'u-9' })
    expect(result.status).toBe('committed')
  })
})

describe('brilliant-directories listings.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v2/listing/create with title and subscription_id', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ listing_id: 'l-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await brilliantDirectoriesConnector.executeMutation!({
      source: source(),
      capabilityName: 'listings.create',
      args: {
        user_id: 'u-1',
        subscription_id: 'sub-1',
        title: 'My Spa',
        meta: { city: 'NYC' },
      },
      idempotencyKey: 'k-listing-create-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('https://example.com/api/v2/listing/create')
    expect(requestBody).toMatchObject({
      user_id: 'u-1',
      subscription_id: 'sub-1',
      title: 'My Spa',
    })
    expect(result.status).toBe('committed')
  })

  it('rejects when title is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      brilliantDirectoriesConnector.executeMutation!({
        source: source(),
        capabilityName: 'listings.create',
        args: { user_id: 'u-1', subscription_id: 'sub-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/title/)
  })
})

describe('brilliant-directories listings.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v2/listing/update with listing_id and merged fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ listing_id: 'l-1', updated: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await brilliantDirectoriesConnector.executeMutation!({
      source: source(),
      capabilityName: 'listings.update',
      args: { listingId: 'l-1', title: 'New Title', meta: { city: 'NYC' } },
      idempotencyKey: 'k-listing-update-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('https://example.com/api/v2/listing/update')
    expect(requestBody).toMatchObject({ listing_id: 'l-1', title: 'New Title' })
    expect(result.status).toBe('committed')
  })
})
