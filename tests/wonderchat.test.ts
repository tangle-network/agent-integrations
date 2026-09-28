import { afterEach, describe, expect, it, vi } from 'vitest'
import { wonderchatConnector } from '../src/connectors/adapters/wonderchat.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_wonderchat_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'wonderchat',
    label: 'wonderchat test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'wonderchat_secret' },
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

describe('wonderchat page.remove', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /chatbot/{chatbotId}/pages/{pageId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ removed: true })
      }),
    )

    const result = await wonderchatConnector.executeMutation!({
      source: source(),
      capabilityName: 'page.remove',
      args: { chatbotId: 'bot_1', pageId: 'page_42' },
      idempotencyKey: 'rm-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/chatbot/bot_1/pages/page_42')
  })
})

describe('wonderchat bot.train', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /chatbot/{chatbotId}/train', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ jobId: 'train_1', status: 'queued' })
      }),
    )

    const result = await wonderchatConnector.executeMutation!({
      source: source(),
      capabilityName: 'bot.train',
      args: { chatbotId: 'bot_1' },
      idempotencyKey: 'train-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/chatbot/bot_1/train')
  })
})

describe('wonderchat conversations.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /chatbot/{chatbotId}/conversations with limit', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({
          conversations: [{ id: 'c1', startedAt: '2026-06-01T00:00:00Z' }],
        })
      }),
    )

    const result = await wonderchatConnector.executeRead!({
      source: source(),
      capabilityName: 'conversations.list',
      args: { chatbotId: 'bot_1', limit: 25 },
      idempotencyKey: 'list-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/chatbot/bot_1/conversations')
    expect(String(requestUrl)).toContain('limit=25')
    const data = result.data as { conversations: Array<{ id: string }> }
    expect(data.conversations).toHaveLength(1)
  })
})

describe('wonderchat conversations.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /chatbot/{chatbotId}/conversations/{chatlogId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ deleted: true })
      }),
    )

    const result = await wonderchatConnector.executeMutation!({
      source: source(),
      capabilityName: 'conversations.delete',
      args: { chatbotId: 'bot_1', chatlogId: 'log_99' },
      idempotencyKey: 'cd-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/chatbot/bot_1/conversations/log_99')
  })
})
