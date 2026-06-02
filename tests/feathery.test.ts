import { afterEach, describe, expect, it, vi } from 'vitest'
import { featheryConnector } from '../src/connectors/adapters/feathery.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_feathery_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'feathery',
    label: 'Feathery test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'feathery_secret' },
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

describe('feathery adapter manifest', () => {
  it('classifies itself as the webhook category and exposes the feathery kind', () => {
    expect(featheryConnector.manifest.kind).toBe('feathery')
    expect(featheryConnector.manifest.category).toBe('webhook')
    expect(featheryConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = featheryConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Feathery/i)
  })

  it('covers form CRUD, submissions, and user CRUD capability surfaces', () => {
    const names = featheryConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'forms.create',
        'forms.update',
        'forms.delete',
        'submissions.list',
        'submissions.export',
        'user.create',
        'user.update',
        'user.delete',
      ].sort(),
    )
    const mutations = featheryConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'forms.create',
        'forms.update',
        'forms.delete',
        'submissions.export',
        'user.create',
        'user.update',
        'user.delete',
      ].sort(),
    )
  })

  it('marks the new user.* mutations as native-idempotency external effects', () => {
    const targets = new Set(['user.create', 'user.update', 'user.delete'])
    for (const cap of featheryConnector.manifest.capabilities) {
      if (!targets.has(cap.name)) continue
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('feathery user.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/users with the id and field_values envelope', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'u_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await featheryConnector.executeMutation!({
      source: source(),
      capabilityName: 'user.create',
      args: { id: 'u_1', field_values: { name: 'Ada' } },
      idempotencyKey: 'k-create',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.feathery.io/api/v1/users')
    expect(requestBody).toEqual({ id: 'u_1', field_values: { name: 'Ada' } })
  })

  it('omits unspecified optional fields from the body', async () => {
    let requestBody: unknown
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'u_2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await featheryConnector.executeMutation!({
      source: source(),
      capabilityName: 'user.create',
      args: { id: 'u_2' },
      idempotencyKey: 'k-create-optional',
    })

    expect(requestBody).toEqual({ id: 'u_2' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      featheryConnector.executeMutation!({
        source: source(),
        capabilityName: 'user.create',
        args: { id: 'u_1' },
        idempotencyKey: 'k-401',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('feathery user.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs the user resource by id', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await featheryConnector.executeMutation!({
      source: source(),
      capabilityName: 'user.delete',
      args: { id: 'u_1' },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.feathery.io/api/v1/users/u_1')
  })
})
