import { afterEach, describe, expect, it, vi } from 'vitest'
import { typefullyConnector } from '../src/connectors/adapters/typefully.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_typefully_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'typefully',
    label: 'typefully test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'typefully_secret' },
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

describe('typefully adapter manifest', () => {
  it('classifies itself as the crm category and exposes the typefully kind', () => {
    expect(typefullyConnector.manifest.kind).toBe('typefully')
    expect(typefullyConnector.manifest.category).toBe('crm')
    expect(typefullyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = typefullyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: draft management, publishing, and write-side mutations', () => {
    const names = typefullyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'accounts.list',
        'drafts.create',
        'drafts.createAdvanced',
        'drafts.delete',
        'drafts.get',
        'drafts.list',
        'drafts.publishNow',
        'drafts.schedule',
        'drafts.unschedule',
        'drafts.update',
        'media.delete',
        'media.upload',
      ].sort(),
    )
    const mutations = typefullyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'drafts.create',
        'drafts.createAdvanced',
        'drafts.delete',
        'drafts.publishNow',
        'drafts.schedule',
        'drafts.unschedule',
        'drafts.update',
        'media.delete',
        'media.upload',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency external-effect', () => {
    const caps = typefullyConnector.manifest.capabilities
    for (const c of caps) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('typefully drafts.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a PATCH /drafts/{draft_id} with the X-API-Key header and patch body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestHeaders: Record<string, string> | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestHeaders = init?.headers as Record<string, string>
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'd_1', text: 'patched' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await typefullyConnector.executeMutation!({
      source: source(),
      capabilityName: 'drafts.update',
      args: { draft_id: 'd_1', text: 'patched' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.typefully.com/v1/drafts/d_1')
    expect(requestHeaders?.['X-API-Key']).toBe('typefully_secret')
    expect(requestBody).toMatchObject({ draft_id: 'd_1', text: 'patched' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      typefullyConnector.executeMutation!({
        source: source(),
        capabilityName: 'drafts.update',
        args: { draft_id: 'd_1', text: 't' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('typefully drafts.unschedule', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /drafts/{draft_id}/unschedule', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'd_1', status: 'draft' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await typefullyConnector.executeMutation!({
      source: source(),
      capabilityName: 'drafts.unschedule',
      args: { draft_id: 'd_1' },
      idempotencyKey: 'k-2',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.typefully.com/v1/drafts/d_1/unschedule')
  })
})

describe('typefully accounts.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /accounts', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse([{ id: 'a_1', platform: 'twitter' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await typefullyConnector.executeRead!({
      source: source(),
      capabilityName: 'accounts.list',
      args: {},
      idempotencyKey: 'k-3',
    })

    expect(requestMethod).toBe('GET')
    expect(requestUrl).toBe('https://api.typefully.com/v1/accounts')
    expect(Array.isArray(result.data)).toBe(true)
  })
})

describe('typefully media.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /media/{media_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await typefullyConnector.executeMutation!({
      source: source(),
      capabilityName: 'media.delete',
      args: { media_id: 'media_42' },
      idempotencyKey: 'k-4',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.typefully.com/v1/media/media_42')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      typefullyConnector.executeMutation!({
        source: source(),
        capabilityName: 'media.delete',
        args: { media_id: 'media_42' },
        idempotencyKey: 'k-4',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
