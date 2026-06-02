import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatbaseConnector } from '../src/connectors/adapters/chatbase.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_chatbase_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'chatbase',
    label: 'Chatbase test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'chatbase-secret' },
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

describe('chatbase adapter manifest', () => {
  it('classifies itself as the crm category and exposes the chatbase kind', () => {
    expect(chatbaseConnector.manifest.kind).toBe('chatbase')
    expect(chatbaseConnector.manifest.category).toBe('crm')
    expect(chatbaseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = chatbaseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the original four actions plus the new chatbot/source writes', () => {
    const names = chatbaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'chatbot.create',
        'chatbot.delete',
        'chatbot.list',
        'chatbot.prompt',
        'chatbot.update',
        'conversations.search',
        'sources.delete',
        'sources.upload',
      ].sort(),
    )
    const reads = chatbaseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = chatbaseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['chatbot.list', 'conversations.search'].sort())
    expect(mutations).toEqual(
      [
        'chatbot.create',
        'chatbot.delete',
        'chatbot.prompt',
        'chatbot.update',
        'sources.delete',
        'sources.upload',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const cap of chatbaseConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('chatbase chatbot.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /update-chatbot with the new configuration', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ chatbotId: 'cb_1', updated: true })
      }),
    )
    const result = await chatbaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'chatbot.update',
      args: {
        chatbotId: 'cb_1',
        chatbotName: 'Support Bot v2',
        model: 'gpt-4o',
        basePrompt: 'You are a helpful assistant.',
        temperature: 0.4,
        visibility: 'private',
      },
      idempotencyKey: 'k-cb-update-1',
    })
    expect(capturedMethod).toBe('PATCH')
    expect(capturedUrl).toBe('https://www.chatbase.co/api/v1/update-chatbot')
    expect(capturedBody).toEqual({
      chatbotId: 'cb_1',
      chatbotName: 'Support Bot v2',
      model: 'gpt-4o',
      basePrompt: 'You are a helpful assistant.',
      temperature: 0.4,
      visibility: 'private',
    })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      chatbaseConnector.executeMutation!({
        source: source(),
        capabilityName: 'chatbot.update',
        args: {
          chatbotId: 'cb_1',
          chatbotName: 'name',
          model: 'gpt-4o',
          basePrompt: 'p',
          temperature: 0.1,
          visibility: 'private',
        },
        idempotencyKey: 'k-cb-update-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('chatbase chatbot.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /delete-chatbot with the chatbot id', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ deleted: true })
      }),
    )
    const result = await chatbaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'chatbot.delete',
      args: { chatbotId: 'cb_1' },
      idempotencyKey: 'k-cb-delete-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://www.chatbase.co/api/v1/delete-chatbot')
    expect(capturedBody).toEqual({ chatbotId: 'cb_1' })
    expect(result.status).toBe('committed')
  })
})

describe('chatbase sources.upload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /upload-source with the source payload', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ sourceId: 'src_1' })
      }),
    )
    const result = await chatbaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'sources.upload',
      args: {
        chatbotId: 'cb_1',
        type: 'text',
        content: 'Our refund policy is 30 days.',
        filename: 'policy.txt',
      },
      idempotencyKey: 'k-src-upload-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://www.chatbase.co/api/v1/upload-source')
    expect(capturedBody).toEqual({
      chatbotId: 'cb_1',
      type: 'text',
      content: 'Our refund policy is 30 days.',
      filename: 'policy.txt',
    })
    expect(result.status).toBe('committed')
  })
})

describe('chatbase sources.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /delete-source with chatbotId and sourceId', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ deleted: true })
      }),
    )
    const result = await chatbaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'sources.delete',
      args: { chatbotId: 'cb_1', sourceId: 'src_1' },
      idempotencyKey: 'k-src-delete-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://www.chatbase.co/api/v1/delete-source')
    expect(capturedBody).toEqual({ chatbotId: 'cb_1', sourceId: 'src_1' })
    expect(result.status).toBe('committed')
  })
})
