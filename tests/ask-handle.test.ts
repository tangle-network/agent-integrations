import { afterEach, describe, expect, it, vi } from 'vitest'
import { askHandleConnector } from '../src/connectors/adapters/ask-handle.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_ask_handle_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'ask-handle',
    label: 'ask-handle test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'ask_handle_secret' },
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

describe('ask-handle adapter manifest', () => {
  it('classifies itself as the other category and exposes the ask-handle kind', () => {
    expect(askHandleConnector.manifest.kind).toBe('ask-handle')
    expect(askHandleConnector.manifest.category).toBe('other')
    expect(askHandleConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = askHandleConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers messages, leads, rooms, and the write-side lifecycle', () => {
    const names = askHandleConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'leads.create',
      'leads.delete',
      'leads.list',
      'leads.update',
      'messages.create',
      'messages.delete',
      'messages.update',
      'rooms.list',
    ])
    const mutations = askHandleConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual([
      'leads.create',
      'leads.delete',
      'leads.update',
      'messages.create',
      'messages.delete',
      'messages.update',
    ])
  })

  it('marks every new write mutation as native-idempotency external-effect', () => {
    for (const name of ['leads.delete', 'leads.update', 'messages.delete', 'messages.update']) {
      const cap = askHandleConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('ask-handle messages.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /api/messages/{message_id} with the new body', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'msg_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await askHandleConnector.executeMutation!({
      source: source(),
      capabilityName: 'messages.update',
      args: { message_id: 'msg_1', body: 'updated text' },
      idempotencyKey: 'k-msg-up',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.askhandle.com/api/messages/msg_1')
    expect(requestBody).toEqual({ body: 'updated text' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      askHandleConnector.executeMutation!({
        source: source(),
        capabilityName: 'messages.update',
        args: { message_id: 'msg_1', body: 'updated text' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('ask-handle leads.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/leads/{lead_id}', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await askHandleConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.delete',
      args: { lead_id: 'lead_1' },
      idempotencyKey: 'k-lead-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.askhandle.com/api/leads/lead_1')
    expect(result.status).toBe('committed')
  })
})

describe('ask-handle leads.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /api/leads/{lead_id} with patched attributes', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'lead_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await askHandleConnector.executeMutation!({
      source: source(),
      capabilityName: 'leads.update',
      args: { lead_id: 'lead_1', email: 'new@example.com' },
      idempotencyKey: 'k-lead-up',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://api.askhandle.com/api/leads/lead_1')
    expect(requestBody).toEqual({ lead_id: 'lead_1', email: 'new@example.com' })
    expect(result.status).toBe('committed')
  })
})
