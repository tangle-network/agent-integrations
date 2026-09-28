import { afterEach, describe, expect, it, vi } from 'vitest'
import { telegramConnector, TELEGRAM_FILE_DOWNLOAD_ROOT } from '../src/connectors/adapters/telegram.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_telegram_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'telegram',
    label: 'Telegram test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: '123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    status: 'active',
    ...overrides,
  }
}

function tgOk<T>(result: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('telegram adapter manifest', () => {
  it('marks every new write capability (media-edit, pin/unpin, ban, restrict) as native-idempotency + external-effect', () => {
    const byName = new Map(telegramConnector.manifest.capabilities.map((c) => [c.name, c]))
    for (const name of [
      'editMessageMedia',
      'pinChatMessage',
      'unpinChatMessage',
      'banChatMember',
      'restrictChatMember',
    ]) {
      const cap = byName.get(name)
      if (!cap || cap.class !== 'mutation') throw new Error(`missing mutation: ${name}`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('exposes the public file-download root used to assemble getFile URLs', () => {
    expect(TELEGRAM_FILE_DOWNLOAD_ROOT).toBe('https://api.telegram.org/file')
  })

  it('test() rejects malformed bot tokens before hitting the network', async () => {
    const result = await telegramConnector.test({
      id: 'src-test',
      projectId: 'proj',
      publishedAgentId: null,
      kind: 'telegram',
      label: 'test',
      consistencyModel: 'advisory',
      scopes: [],
      metadata: {},
      credentials: { kind: 'api-key', apiKey: 'this-is-not-a-bot-token' },
      status: 'active',
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toMatch(/BotFather|token/i)
  })
})

describe('telegram pinChatMessage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /bot{token}/pinChatMessage with the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(String(init.body)) : null
        return tgOk(true)
      }),
    )
    const result = await telegramConnector.executeMutation!({
      source: source(),
      capabilityName: 'pinChatMessage',
      args: { chat_id: 42, message_id: 7 },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/pinChatMessage')
    expect(requestBody).toMatchObject({ chat_id: 42, message_id: 7 })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      telegramConnector.executeMutation!({
        source: source(),
        capabilityName: 'pinChatMessage',
        args: { chat_id: 42, message_id: 7 },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('telegram unpinChatMessage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /bot{token}/unpinChatMessage', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        requestUrl = String(input)
        return tgOk(true)
      }),
    )
    const result = await telegramConnector.executeMutation!({
      source: source(),
      capabilityName: 'unpinChatMessage',
      args: { chat_id: 42 },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/unpinChatMessage')
  })
})

describe('telegram editMessageMedia', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /bot{token}/editMessageMedia with media payload', async () => {
    let requestUrl: string | undefined
    let requestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestBody = init?.body ? JSON.parse(String(init.body)) : null
        return tgOk({ message_id: 9 })
      }),
    )
    const result = await telegramConnector.executeMutation!({
      source: source(),
      capabilityName: 'editMessageMedia',
      args: { chat_id: 42, message_id: 9, media: { type: 'photo', media: 'https://example.com/p.jpg' } },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/editMessageMedia')
    expect(requestBody).toMatchObject({ media: { type: 'photo' } })
  })
})

describe('telegram banChatMember', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /bot{token}/banChatMember', async () => {
    let requestUrl: string | undefined
    let requestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestBody = init?.body ? JSON.parse(String(init.body)) : null
        return tgOk(true)
      }),
    )
    const result = await telegramConnector.executeMutation!({
      source: source(),
      capabilityName: 'banChatMember',
      args: { chat_id: 42, user_id: 99 },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/banChatMember')
    expect(requestBody).toMatchObject({ chat_id: 42, user_id: 99 })
  })
})

describe('telegram restrictChatMember', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /bot{token}/restrictChatMember with permissions', async () => {
    let requestUrl: string | undefined
    let requestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestBody = init?.body ? JSON.parse(String(init.body)) : null
        return tgOk(true)
      }),
    )
    const result = await telegramConnector.executeMutation!({
      source: source(),
      capabilityName: 'restrictChatMember',
      args: {
        chat_id: 42,
        user_id: 99,
        permissions: { can_send_messages: false },
      },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/restrictChatMember')
    expect(requestBody).toMatchObject({
      chat_id: 42,
      user_id: 99,
      permissions: { can_send_messages: false },
    })
  })
})
