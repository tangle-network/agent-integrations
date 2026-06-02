import { afterEach, describe, expect, it, vi } from 'vitest'
import { wufooConnector } from '../src/connectors/adapters/wufoo.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_wufoo_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'wufoo',
    label: 'wufoo test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'wufoo_secret' },
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

describe('wufoo adapter manifest', () => {
  it('classifies itself as the other category and exposes the wufoo kind', () => {
    expect(wufooConnector.manifest.kind).toBe('wufoo')
    expect(wufooConnector.manifest.category).toBe('other')
    expect(wufooConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Wufoo-specific hint', () => {
    const auth = wufooConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Wufoo/i)
  })

  it('covers forms and entries capability surface', () => {
    const names = wufooConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('entries.create')
    expect(names).toContain('entries.get')
    expect(names).toContain('entries.list')
    expect(names).toContain('entries.search')
    expect(names).toContain('entries.update')
    expect(names).toContain('entries.delete')
    expect(names).toContain('fields.list')
    expect(names).toContain('forms.find')
    expect(names).toContain('forms.list')
    expect(names).toContain('webhooks.create')
    expect(names).toContain('webhooks.delete')
  })

  it('marks form entry creation as mutation', () => {
    const mutations = wufooConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('entries.create')
    expect(mutations).toContain('entries.update')
    expect(mutations).toContain('entries.delete')
    expect(mutations).toContain('webhooks.create')
    expect(mutations).toContain('webhooks.delete')
  })

  it('marks read-only operations as read', () => {
    const reads = wufooConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('entries.get')
    expect(reads).toContain('entries.list')
    expect(reads).toContain('entries.search')
    expect(reads).toContain('fields.list')
    expect(reads).toContain('forms.find')
    expect(reads).toContain('forms.list')
  })

  it('marks new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['entries.update', 'entries.delete', 'webhooks.create', 'webhooks.delete']
    for (const name of expected) {
      const cap = wufooConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('wufoo entries.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /forms/{formHash}/entries/{entryId}.json with the data payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ EntryId: '12' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await wufooConnector.executeMutation!({
      source: source(),
      capabilityName: 'entries.update',
      args: {
        formHash: 'abc123',
        entryId: '12',
        data: { Field1: 'updated' },
      },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(requestUrl).toBe('https://{subdomain}.wufoo.com/api/v3/forms/abc123/entries/12.json')
    expect(requestBody).toEqual({ Field1: 'updated' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      wufooConnector.executeMutation!({
        source: source(),
        capabilityName: 'entries.update',
        args: { formHash: 'abc', entryId: '1', data: { Field1: 'x' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('wufoo entries.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /forms/{formHash}/entries/{entryId}.json', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await wufooConnector.executeMutation!({
      source: source(),
      capabilityName: 'entries.delete',
      args: { formHash: 'abc123', entryId: '12' },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://{subdomain}.wufoo.com/api/v3/forms/abc123/entries/12.json')
  })
})

describe('wufoo webhooks.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /forms/{formHash}/webhooks.json with the target url', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ WebHookPutResult: { Hash: 'wh_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await wufooConnector.executeMutation!({
      source: source(),
      capabilityName: 'webhooks.create',
      args: {
        formHash: 'abc123',
        url: 'https://example.com/hook',
      },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('PUT')
    expect(requestUrl).toBe('https://{subdomain}.wufoo.com/api/v3/forms/abc123/webhooks.json')
    expect(requestBody).toMatchObject({ url: 'https://example.com/hook' })
  })
})

describe('wufoo webhooks.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /forms/{formHash}/webhooks/{webhookHash}.json', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await wufooConnector.executeMutation!({
      source: source(),
      capabilityName: 'webhooks.delete',
      args: { formHash: 'abc123', webhookHash: 'wh_1' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://{subdomain}.wufoo.com/api/v3/forms/abc123/webhooks/wh_1.json')
  })
})
