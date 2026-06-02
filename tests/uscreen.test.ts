import { afterEach, describe, expect, it, vi } from 'vitest'
import { uscreenConnector } from '../src/connectors/adapters/uscreen.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_uscreen_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'uscreen',
    label: 'uscreen test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'uscreen_secret' },
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

describe('uscreen adapter manifest', () => {
  it('classifies itself as the crm category and exposes the uscreen kind', () => {
    expect(uscreenConnector.manifest.kind).toBe('uscreen')
    expect(uscreenConnector.manifest.category).toBe('crm')
    expect(uscreenConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Uscreen-specific hint', () => {
    const auth = uscreenConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Uscreen/i)
  })

  it('covers users and access management capabilities', () => {
    const names = uscreenConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('users.create')
    expect(names).toContain('users.update')
    expect(names).toContain('users.delete')
    expect(names).toContain('users.list')
    expect(names).toContain('access.assign')
    expect(names).toContain('access.revoke')
  })

  it('marks destructive operations as mutations', () => {
    const mutations = uscreenConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('users.create')
    expect(mutations).toContain('users.update')
    expect(mutations).toContain('users.delete')
    expect(mutations).toContain('access.assign')
    expect(mutations).toContain('access.revoke')
  })

  it('marks new write-side mutations as native-idempotency external effect', () => {
    const expected = ['users.update', 'users.delete', 'access.revoke']
    for (const name of expected) {
      const cap = uscreenConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('uscreen users.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a PATCH to /v1/users/{user_id} with updated fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'u_1', email: 'updated@example.com' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uscreenConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.update',
      args: {
        user_id: 'u_1',
        email: 'updated@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        password: 'secret123',
        opted_in_for_news_and_updates: true,
        custom_fields: { tier: 'gold' },
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/users/u_1')
    expect(requestBody).toMatchObject({ email: 'updated@example.com' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      uscreenConnector.executeMutation!({
        source: source(),
        capabilityName: 'users.update',
        args: {
          user_id: 'u_1',
          email: 'updated@example.com',
          first_name: 'Jane',
          last_name: 'Doe',
          password: 'secret123',
          opted_in_for_news_and_updates: true,
          custom_fields: { tier: 'gold' },
        },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('uscreen users.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/users/{user_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uscreenConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.delete',
      args: { user_id: 'u_99' },
      idempotencyKey: 'k-del-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/users/u_99')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      uscreenConnector.executeMutation!({
        source: source(),
        capabilityName: 'users.delete',
        args: { user_id: 'u_1' },
        idempotencyKey: 'k-del-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('uscreen access.revoke', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/users/{user_id}/access/{product_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uscreenConnector.executeMutation!({
      source: source(),
      capabilityName: 'access.revoke',
      args: { user_id: 'u_1', product_id: 'p_1' },
      idempotencyKey: 'k-rev-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/users/u_1/access/p_1')
  })
})
