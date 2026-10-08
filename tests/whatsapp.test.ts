import { afterEach, describe, expect, it, vi } from 'vitest'
import { whatsappConnector } from '../src/connectors/adapters/whatsapp.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_whatsapp_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'whatsapp',
    label: 'whatsapp test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'whatsapp_secret' },
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

describe('whatsapp messages.reply', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs JSON body containing context.message_id to the Meta phone number endpoint', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = String(init?.body)
        return jsonResponse({ messages: [{ id: 'wamid.reply' }] })
      }),
    )

    const result = await whatsappConnector.executeMutation!({
      source: source(),
      capabilityName: 'messages.reply',
      args: {
        phoneNumberId: '123456789',
        to: '+14155551234',
        text: 'replying inline',
        replyToMessageId: 'wamid.orig',
      },
      idempotencyKey: 'reply-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://graph.facebook.com/v21.0/123456789/messages')
    const parsed = JSON.parse(requestBody ?? '{}') as {
      messaging_product: string
      to: string
      type: string
      context: { message_id: string }
      text: { body: string }
    }
    expect(parsed.messaging_product).toBe('whatsapp')
    expect(parsed.to).toBe('+14155551234')
    expect(parsed.context.message_id).toBe('wamid.orig')
    expect(parsed.text.body).toBe('replying inline')
  })
})

describe('whatsapp messages.react', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs reaction body with the emoji and message id', async () => {
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = String(init?.body)
        return jsonResponse({ messages: [{ id: 'wamid.react' }] })
      }),
    )

    const result = await whatsappConnector.executeMutation!({
      source: source(),
      capabilityName: 'messages.react',
      args: {
        phoneNumberId: '123456789',
        to: '+14155551234',
        messageId: 'wamid.target',
        emoji: '🔥',
      },
      idempotencyKey: 'react-1',
    })

    expect(result.status).toBe('committed')
    const parsed = JSON.parse(requestBody ?? '{}') as {
      type: string
      reaction: { message_id: string; emoji: string }
    }
    expect(parsed.type).toBe('reaction')
    expect(parsed.reaction.message_id).toBe('wamid.target')
    expect(parsed.reaction.emoji).toBe('🔥')
  })
})

describe('WhatsApp Cloud API send routing', () => {
  afterEach(() => vi.unstubAllGlobals())

  const sends = [
    ['messages.send', { to: '+14155551234', text: 'Hello' }],
    ['media.send', { to: '+14155551234', type: 'image', media: 'https://example.com/photo.jpg' }],
    ['template.send', { to: '+14155551234', templateName: 'hello_world', language: 'en_US', parameters: [] }],
    ['messages.reply', { to: '+14155551234', text: 'Hello', replyToMessageId: 'wamid.original' }],
    ['messages.react', { to: '+14155551234', messageId: 'wamid.original', emoji: '👍' }],
  ] as const

  it.each(sends)('%s uses an explicit phone number ID on the Facebook Graph host', async (capabilityName, args) => {
    const fetch = vi.fn(async () => jsonResponse({ messages: [{ id: 'wamid.sent' }] }))
    vi.stubGlobal('fetch', fetch)
    await whatsappConnector.executeMutation!({ source: source(), capabilityName,
      args: { ...args, phoneNumberId: '123456789' }, idempotencyKey: 'route-1' })
    const [url, init] = fetch.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    expect(String(url)).toBe('https://graph.facebook.com/v21.0/123456789/messages')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer whatsapp_secret')
  })

  it.each(sends)('%s rejects a WABA-only request before making a network call', async (capabilityName, args) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(whatsappConnector.executeMutation!({ source: source(), capabilityName,
      args: { ...args, businessAccountId: '987654321' }, idempotencyKey: 'old-id' })).rejects.toThrow(/phoneNumberId/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 123456789, '123/messages', 'not-a-meta-id'])('rejects invalid phone number ID %s', async phoneNumberId => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(whatsappConnector.executeMutation!({ source: source(), capabilityName: 'messages.send',
      args: { phoneNumberId, to: '+14155551234', text: 'Hello' }, idempotencyKey: 'invalid-id' })).rejects.toThrow(/phoneNumberId/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('checks the token without inventing a phone or WABA ID', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ id: 'system-user-1' }))
    vi.stubGlobal('fetch', fetch)
    expect(await whatsappConnector.test!(source())).toEqual({ ok: true })
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://graph.facebook.com/v21.0/me?fields=id')
  })

  it('rejects an ambiguous request containing both account and phone IDs', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(whatsappConnector.executeMutation!({ source: source(), capabilityName: 'messages.send',
      args: { phoneNumberId: '123456789', businessAccountId: '987654321', to: '+14155551234', text: 'Hello' },
      idempotencyKey: 'ambiguous-id' })).rejects.toThrow(/phoneNumberId/)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('whatsapp messages.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /{businessAccountId}/messages/{messageId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ success: true })
      }),
    )

    const result = await whatsappConnector.executeMutation!({
      source: source(),
      capabilityName: 'messages.delete',
      args: { businessAccountId: 'BA_42', messageId: 'wamid.gone' },
      idempotencyKey: 'del-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/BA_42/messages/wamid.gone')
  })
})

describe('whatsapp contacts.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /{businessAccountId}/contacts', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ data: [{ wa_id: '14155551234', profile: { name: 'Alice' } }] })
      }),
    )

    const result = await whatsappConnector.executeRead!({
      source: source(),
      capabilityName: 'contacts.list',
      args: { businessAccountId: 'BA_42', limit: 50 },
      idempotencyKey: 'contacts-1',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/BA_42/contacts')
    expect(String(requestUrl)).toContain('limit=50')
    const data = result.data as { data: Array<{ wa_id: string }> }
    expect(data.data).toHaveLength(1)
  })
})
