import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatsistantConnector } from '../src/connectors/adapters/chatsistant.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_chatsistant_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'chatsistant',
    label: 'Chatsistant test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'chatsistant_secret' },
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

describe('chatsistant adapter manifest', () => {
  it('classifies itself as the comms category and exposes the chatsistant kind', () => {
    expect(chatsistantConnector.manifest.kind).toBe('chatsistant')
    expect(chatsistantConnector.manifest.category).toBe('comms')
    expect(chatsistantConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = chatsistantConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers send + conversation.create + message.delete', () => {
    const names = chatsistantConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['conversation.create', 'message.delete', 'message.send'])
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const cap of chatsistantConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('chatsistant conversation.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/conversation/create with chatbot_uuid', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ session_uuid: 'sess_abc' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatsistantConnector.executeMutation!({
      source: source(),
      capabilityName: 'conversation.create',
      args: { chatbot_uuid: 'bot_1', metadata: { user: 'alice' } },
      idempotencyKey: 'conv-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.chatsistant.com/v1/conversation/create')
    expect(capturedBody).toMatchObject({ chatbot_uuid: 'bot_1', metadata: { user: 'alice' } })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      chatsistantConnector.executeMutation!({
        source: source(),
        capabilityName: 'conversation.create',
        args: { chatbot_uuid: 'bot_1', metadata: {} },
        idempotencyKey: 'conv-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('chatsistant message.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/message/{message_uuid}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatsistantConnector.executeMutation!({
      source: source(),
      capabilityName: 'message.delete',
      args: { message_uuid: 'msg_1' },
      idempotencyKey: 'del-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.chatsistant.com/v1/message/msg_1')
    expect(result.status).toBe('committed')
  })
})
