import { afterEach, describe, expect, it, vi } from 'vitest'
import { smooveConnector } from '../src/connectors/adapters/smoove.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_smoove_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'smoove',
    label: 'smoove test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'smoove_secret' },
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

describe('smoove adapter manifest', () => {
  it('classifies itself as the crm category and exposes the smoove kind', () => {
    expect(smooveConnector.manifest.kind).toBe('smoove')
    expect(smooveConnector.manifest.category).toBe('crm')
    expect(smooveConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Smoove-specific hint', () => {
    const auth = smooveConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Smoove/i)
  })

  it('covers lists, subscribers, and campaign capability surface', () => {
    const names = smooveConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('lists.get')
    expect(names).toContain('lists.create')
    expect(names).toContain('lists.delete')
    expect(names).toContain('subscribers.add')
    expect(names).toContain('subscribers.find')
    expect(names).toContain('subscribers.unsubscribe')
    expect(names).toContain('subscribers.update')
    expect(names).toContain('subscribers.delete')
    expect(names).toContain('campaigns.send')
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['subscribers.update', 'subscribers.delete', 'lists.delete', 'campaigns.send']
    for (const name of expected) {
      const cap = smooveConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('smoove subscribers.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /v1/subscribers/{id} with the data object as the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'sub_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smooveConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.update',
      args: { id: 'sub_1', data: { firstName: 'Alice', lastName: 'Smith' } },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PUT')
    expect(requestUrl).toBe('https://api.smoove.io/v1/subscribers/sub_1')
    expect(requestBody).toMatchObject({ firstName: 'Alice', lastName: 'Smith' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      smooveConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscribers.update',
        args: { id: 'sub_1', data: { firstName: 'x' } },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('smoove subscribers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/subscribers/{id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await smooveConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.delete',
      args: { id: 'sub_77' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.smoove.io/v1/subscribers/sub_77')
    expect(result.status).toBe('committed')
  })
})

describe('smoove lists.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/lists/{id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await smooveConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.delete',
      args: { id: 'list_5' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.smoove.io/v1/lists/list_5')
  })
})

describe('smoove campaigns.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/campaigns/{id}/send', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await smooveConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.send',
      args: { id: 'camp_1' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.smoove.io/v1/campaigns/camp_1/send')
  })
})
