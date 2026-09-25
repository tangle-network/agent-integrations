import { afterEach, describe, expect, it, vi } from 'vitest'
import { bonjoroConnector } from '../src/connectors/adapters/bonjoro.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bonjoro_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bonjoro',
    label: 'Bonjoro test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bonjoro-secret' },
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

describe('bonjoro greets.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /greets/{greetId} with merged fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'greet-1', note: 'new note' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bonjoroConnector.executeMutation!({
      source: source(),
      capabilityName: 'greets.update',
      args: {
        greetId: 'greet-1',
        note: 'new note',
        assignee: 'u-9',
        template: 't-1',
        campaign: 'c-1',
        custom: { tier: 'gold' },
      },
      idempotencyKey: 'k-update-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('https://app.bonjoro.com/api/v2/greets/greet-1')
    expect(requestBody).toMatchObject({ note: 'new note', assignee: 'u-9' })
    expect(result.status).toBe('committed')
  })

  it('rejects when greetId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      bonjoroConnector.executeMutation!({
        source: source(),
        capabilityName: 'greets.update',
        args: { note: 'updated' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/greetId/)
  })
})

describe('bonjoro greets.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /greets/{greetId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bonjoroConnector.executeMutation!({
      source: source(),
      capabilityName: 'greets.delete',
      args: { greetId: 'greet-1' },
      idempotencyKey: 'k-delete-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('https://app.bonjoro.com/api/v2/greets/greet-1')
    expect(result.status).toBe('committed')
  })
})

describe('bonjoro campaigns.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /campaigns with the campaign payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'cmp-1', name: 'Welcome' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bonjoroConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.create',
      args: {
        name: 'Welcome',
        assignee: 'u-1',
        template: 't-1',
        description: 'welcome wagon',
      },
      idempotencyKey: 'k-camp-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('https://app.bonjoro.com/api/v2/campaigns')
    expect(requestBody).toMatchObject({ name: 'Welcome', assignee: 'u-1' })
    expect(result.status).toBe('committed')
  })

  it('rejects when name is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      bonjoroConnector.executeMutation!({
        source: source(),
        capabilityName: 'campaigns.create',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/name/)
  })
})
