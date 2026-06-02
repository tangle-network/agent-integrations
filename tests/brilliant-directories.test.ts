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

describe('brilliant-directories adapter manifest', () => {
  it('classifies itself as the crm category and exposes the brilliant-directories kind', () => {
    expect(brilliantDirectoriesConnector.manifest.kind).toBe('brilliant-directories')
    expect(brilliantDirectoriesConnector.manifest.category).toBe('crm')
    expect(brilliantDirectoriesConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = brilliantDirectoriesConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers users CRUD and listings create/update', () => {
    const names = brilliantDirectoriesConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'users.create',
        'users.update',
        'users.delete',
        'listings.create',
        'listings.update',
      ].sort(),
    )
    const mutations = brilliantDirectoriesConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['listings.create', 'listings.update', 'users.create', 'users.delete', 'users.update'].sort(),
    )
  })

  it('marks every mutation with native-idempotency CAS and external effect', () => {
    for (const c of brilliantDirectoriesConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      brilliantDirectoriesConnector.executeMutation!({
        source: source(),
        capabilityName: 'users.delete',
        args: { userId: 'u-9' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
