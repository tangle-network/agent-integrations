import { afterEach, describe, expect, it, vi } from 'vitest'
import { recallAiConnector } from '../src/connectors/adapters/recall-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(metadata: Record<string, unknown> = {}): ResolvedDataSource {
  return {
    id: 'src_recall_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'recall-ai',
    label: 'Recall.ai test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata,
    credentials: { kind: 'api-key', apiKey: 'recall_secret' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('recall-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the recall-ai kind', () => {
    expect(recallAiConnector.manifest.kind).toBe('recall-ai')
    expect(recallAiConnector.manifest.category).toBe('comms')
    expect(recallAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = recallAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Recall/i)
  })

  it('covers the bots and messages capability surface', () => {
    const names = recallAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['bots.create', 'bots.retrieve', 'messages.send'].sort())
    const mutations = recallAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['bots.create', 'messages.send'].sort())
  })
})

describe('recall-ai execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the selected regional host and a raw Authorization API key', async () => {
    let requestUrl = ''
    let requestHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = init?.headers as Record<string, string>
      return jsonResponse({ id: 'bot_42', status: 'in_call' })
    }))

    await recallAiConnector.executeRead!({
      source: source({ server: 'https://eu-central-1.recall.ai' }),
      capabilityName: 'bots.retrieve',
      args: { bot_id: 'bot_42' },
      idempotencyKey: 'recall-read-bot-42',
    })

    expect(requestUrl).toBe('https://eu-central-1.recall.ai/api/v1/bot/bot_42')
    expect(requestHeaders.Authorization ?? requestHeaders.authorization).toBe('recall_secret')
  })

  it('creates bots through the singular /bot/ route on the default region', async () => {
    let requestUrl = ''
    let requestBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = JSON.parse(init?.body as string) as Record<string, unknown>
      return jsonResponse({ id: 'bot_43' }, 201)
    }))

    await recallAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'bots.create',
      args: {
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        bot_name: 'Tangle Notes',
      },
      idempotencyKey: 'recall-create-43',
    })

    expect(requestUrl).toBe('https://us-east-1.recall.ai/api/v1/bot/')
    expect(requestBody).toEqual({
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      bot_name: 'Tangle Notes',
    })
  })

  it('sends a chat message with optional recipient and pin fields', async () => {
    let requestUrl = ''
    let requestBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = JSON.parse(init?.body as string) as Record<string, unknown>
      return jsonResponse({ ok: true })
    }))

    await recallAiConnector.executeMutation!({
      source: source({ server: 'https://us-west-2.recall.ai' }),
      capabilityName: 'messages.send',
      args: { bot_id: 'bot_44', message: 'Action item recorded', to: 'everyone', pin: true },
      idempotencyKey: 'recall-message-44',
    })

    expect(requestUrl).toBe('https://us-west-2.recall.ai/api/v1/bot/bot_44/send_chat_message/')
    expect(requestBody).toEqual({ message: 'Action item recorded', to: 'everyone', pin: true })
  })

  it('rejects a non-Recall server before sending credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(recallAiConnector.executeRead!({
      source: source({ server: 'https://attacker.example' }),
      capabilityName: 'bots.retrieve',
      args: { bot_id: 'bot_45' },
      idempotencyKey: 'recall-rejected-server-45',
    })).rejects.toThrow('connection base URL is not an allowed provider endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces rejected Recall.ai credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))

    await expect(recallAiConnector.executeRead!({
      source: source(),
      capabilityName: 'bots.retrieve',
      args: { bot_id: 'bot_45' },
      idempotencyKey: 'recall-rejected-credentials-45',
    })).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
