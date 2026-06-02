import { afterEach, describe, expect, it, vi } from 'vitest'
import { timelinesAiConnector } from '../src/connectors/adapters/timelines-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_timelines-ai_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'timelines-ai',
    label: 'timelines-ai test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'timelines_secret' },
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

describe('timelines-ai adapter manifest', () => {
  it('classifies itself as the crm category and exposes the timelines-ai kind', () => {
    expect(timelinesAiConnector.manifest.kind).toBe('timelines-ai')
    expect(timelinesAiConnector.manifest.category).toBe('crm')
    expect(timelinesAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = timelinesAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set plus assignment/tagging/read/notes write-side', () => {
    const names = timelinesAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'chats.find',
        'chats.close',
        'chats.assign',
        'chats.tag',
        'messages.find',
        'messages.status',
        'messages.send',
        'messages.send.to.new.chat',
        'messages.markRead',
        'files.find',
        'files.send',
        'files.send.uploaded',
        'accounts.find',
        'notes.create',
      ].sort(),
    )
    const reads = timelinesAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = timelinesAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['chats.find', 'messages.find', 'messages.status', 'files.find', 'accounts.find'].sort(),
    )
    expect(mutations).toEqual(
      [
        'chats.close',
        'chats.assign',
        'chats.tag',
        'messages.send',
        'messages.send.to.new.chat',
        'messages.markRead',
        'files.send',
        'files.send.uploaded',
        'notes.create',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    const mutations = timelinesAiConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const cap of mutations) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('timelines-ai chats.assign', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/chats/{jid}/assign with the responsible_id body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await timelinesAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'chats.assign',
      args: { jid: '123@c.us', responsible_id: 'user_42' },
      idempotencyKey: 'k-assign-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.timelines.ai/v1/chats/123%40c.us/assign')
    expect(requestBody).toEqual({ responsible_id: 'user_42' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      timelinesAiConnector.executeMutation!({
        source: source(),
        capabilityName: 'chats.assign',
        args: { jid: '123@c.us', responsible_id: 'user_42' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('timelines-ai chats.tag', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/chats/{jid}/labels with the label body', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await timelinesAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'chats.tag',
      args: { jid: '999@c.us', label: 'VIP' },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.timelines.ai/v1/chats/999%40c.us/labels')
    expect(requestBody).toEqual({ label: 'VIP' })
  })
})

describe('timelines-ai messages.markRead', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/messages/{message_uid}/read', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await timelinesAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'messages.markRead',
      args: { message_uid: 'msg_uid_1' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.timelines.ai/v1/messages/msg_uid_1/read')
    expect(result.status).toBe('committed')
  })
})

describe('timelines-ai notes.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/chats/{jid}/notes with the note text', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'note_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await timelinesAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'notes.create',
      args: { jid: '888@c.us', text: 'follow up on monday' },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.timelines.ai/v1/chats/888%40c.us/notes')
    expect(requestBody).toEqual({ text: 'follow up on monday' })
  })
})
