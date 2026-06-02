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

describe('whatsapp adapter manifest', () => {
  it('classifies itself as the comms category and exposes the whatsapp kind', () => {
    expect(whatsappConnector.manifest.kind).toBe('whatsapp')
    expect(whatsappConnector.manifest.category).toBe('comms')
    expect(whatsappConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a WhatsApp-specific hint', () => {
    const auth = whatsappConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/WhatsApp/i)
  })

  it('covers message, media, template, reply, react, delete, contacts capabilities', () => {
    const names = whatsappConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('media.send')
    expect(names).toContain('messages.send')
    expect(names).toContain('template.send')
    expect(names).toContain('messages.reply')
    expect(names).toContain('messages.react')
    expect(names).toContain('messages.delete')
    expect(names).toContain('contacts.list')
  })

  it('marks every mutation as native-idempotency external effect', () => {
    const mutations = whatsappConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const c of mutations) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })

  it('marks contacts.list as a read', () => {
    const reads = whatsappConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('contacts.list')
  })
})

describe('whatsapp messages.reply', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs JSON body containing context.message_id to /{businessAccountId}/messages', async () => {
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
        businessAccountId: 'BA_42',
        to: '+14155551234',
        text: 'replying inline',
        replyToMessageId: 'wamid.orig',
      },
      idempotencyKey: 'reply-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/BA_42/messages')
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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      whatsappConnector.executeMutation!({
        source: source(),
        capabilityName: 'messages.reply',
        args: {
          businessAccountId: 'BA_42',
          to: '+14155551234',
          text: 'x',
          replyToMessageId: 'wamid.orig',
        },
        idempotencyKey: 'reply-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
        businessAccountId: 'BA_42',
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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      whatsappConnector.executeMutation!({
        source: source(),
        capabilityName: 'messages.react',
        args: {
          businessAccountId: 'BA_42',
          to: '+14155551234',
          messageId: 'wamid.target',
          emoji: '🔥',
        },
        idempotencyKey: 'react-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      whatsappConnector.executeMutation!({
        source: source(),
        capabilityName: 'messages.delete',
        args: { businessAccountId: 'BA_42', messageId: 'wamid.gone' },
        idempotencyKey: 'del-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      whatsappConnector.executeRead!({
        source: source(),
        capabilityName: 'contacts.list',
        args: { businessAccountId: 'BA_42' },
        idempotencyKey: 'contacts-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
