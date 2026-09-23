import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { linqWhatsappConnector } from '../src/connectors/adapters/linq-whatsapp.js'
import { listConversationChannels, normalizeConversationEvent, buildMessagingReply } from '../src/conversation-events/index.js'
import { linqWhatsappWebhookProvider } from '../src/webhooks/messaging.js'
import { WebhookRouter } from '../src/webhooks/router.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const now = 1_800_000_000_000
const secret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`
const source: ResolvedDataSource = { id: 'connection', projectId: 'project', publishedAgentId: null,
  kind: 'linq-whatsapp', label: 'WhatsApp', consistencyModel: 'advisory', scopes: [], metadata: {},
  credentials: { kind: 'api-key', apiKey: 'fixture-brand-key' }, status: 'active' }
const payload = () => ({ id: 'event-1', type: 'message.received', timestamp: new Date(now).toISOString(), data: {
  chat_id: 'chat-1', message: { id: 'message-1', chat_id: 'chat-1', direction: 'inbound',
    created_at: new Date(now).toISOString(), from: '+15550000002', parts: [{ type: 'text', body: 'Find a desk' }] },
} })
const input = (value: unknown = payload()) => ({ provider: 'linq-whatsapp', type: 'linq-whatsapp.message.received', payload: value })
function headers(raw: string, id = 'event-1', timestamp = now / 1000) {
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp),
    'webhook-signature': `v1,${createHmac('sha256', Buffer.alloc(32, 7)).update(`${id}.${timestamp}.${raw}`).digest('base64')}` }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Linq WhatsApp wire contract', () => {
  it('uses the separate service, pinned chat and host-owned idempotency header', async () => {
    const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'accepted' }, { status: 202 }))
    vi.stubGlobal('fetch', send)
    const result = await linqWhatsappConnector.executeMutation!({ source, capabilityName: 'messages.reply',
      args: { chat_id: 'chat/1', text: 'Two options', requestKey: 'model-controlled', to: 'wrong' }, idempotencyKey: 'operation-1' })
    expect(result.status).toBe('committed')
    expect(send).toHaveBeenCalledTimes(1)
    const [url, init] = send.mock.calls[0]!
    expect(String(url)).toBe('https://whatsapp.messages.api.linqapp.com/v1/chats/chat%2F1/messages')
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('operation-1')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-brand-key')
    expect(JSON.parse(String(init?.body))).toEqual({ parts: [{ type: 'text', body: 'Two options' }] })
  })
  it.each(['', 'x'.repeat(256), 'bad\nkey', 'bad key', 'é'])('rejects invalid operation keys: %j', async key => {
    const send = vi.fn(); vi.stubGlobal('fetch', send)
    await expect(linqWhatsappConnector.executeMutation!({ source, capabilityName: 'messages.reply', args: { chat_id: 'c', text: 'Hi' }, idempotencyKey: key })).rejects.toThrow('operation key')
    expect(send).not.toHaveBeenCalled()
  })
  it('does not retry an uncertain send or substitute a template on refusal', async () => {
    const send = vi.fn(async () => { throw new Error('response lost') }); vi.stubGlobal('fetch', send)
    await expect(linqWhatsappConnector.executeMutation!({ source, capabilityName: 'messages.reply', args: { chat_id: 'c', text: 'Hi' }, idempotencyKey: 'op' })).rejects.toThrow('response lost')
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('treats a throttled read as a failure, not message history', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 429, headers: { 'retry-after': '4' } }))
    await expect(linqWhatsappConnector.executeRead!({ source, capabilityName: 'chats.get', args: { chat_id: 'chat' }, idempotencyKey: 'read' })).rejects.toMatchObject({ name: 'ProviderRateLimited' })
  })
})

describe('WhatsApp events and replies', () => {
  it('does not mistake the owned destination number for the customer', () => {
    const result = normalizeConversationEvent(input())
    expect(result).toMatchObject({ ok: true, event: { provider: 'linq-whatsapp', eventId: 'message-1', conversationId: 'chat-1',
      sender: { id: 'customer:chat-1', address: null }, destinations: [{ address: '+15550000002' }], text: 'Find a desk' } })
    expect(buildMessagingReply(input(), 'Found two', 'op')).toEqual({ ok: true, reply: { idempotencyKey: 'op', action: 'linq-whatsapp.messages.reply', input: { chat_id: 'chat-1', text: 'Found two' } } })
  })
  it.each(['outbound', 'unknown'])('ignores %s direction', direction => {
    const value = payload(); value.data.message.direction = direction
    expect(normalizeConversationEvent(input(value)).ok).toBe(false)
  })
  it('does not execute delivery receipts, mismatched chats or historical range-only events', () => {
    const value = payload(); value.type = 'message.delivered'
    expect(normalizeConversationEvent(input(value)).ok).toBe(false)
    value.type = 'message.received'; value.data.chat_id = 'other'
    expect(normalizeConversationEvent(input(value)).ok).toBe(false)
    expect(normalizeConversationEvent(input({ ...payload(), data: { chat_id: 'chat-1', seq_from: 1, seq_to: 2 } })).ok).toBe(false)
  })
  it('keeps incoming audio and image attachments with captions and authenticated URLs', () => {
    const url = 'https://whatsapp.messages.api.linqapp.com/v1/attachments/media_1/content'
    const value = { ...payload(), data: { ...payload().data, message: { ...payload().data.message, parts: [
      { type: 'text', body: 'Please check this' },
      { type: 'media', kind: 'audio', media_id: 'channel-audio', mime_type: 'audio/ogg; codecs=opus', byte_size: 4, url },
      { type: 'media', kind: 'image', media_id: 'channel-image', mime_type: 'image/jpeg', caption: 'The room', url },
    ] } } }
    expect(normalizeConversationEvent(input(value))).toMatchObject({ ok: true, event: {
      text: 'Please check this\nThe room', historyOnly: false,
      attachments: [{ id: 'channel-audio', contentType: 'audio/ogg; codecs=opus', size: 4, url },
        { id: 'channel-image', contentType: 'image/jpeg', url }],
    } })
    const pending = { ...payload(), data: { ...payload().data, message: { ...payload().data.message, parts: [
      { type: 'media', kind: 'audio', media_id: 'channel-audio' },
    ] } } }
    expect(normalizeConversationEvent(input(pending))).toMatchObject({ ok: true, event: { historyOnly: true, attachments: [{ url: null }] } })
    const explicitNull = { ...payload(), data: { ...payload().data, message: { ...payload().data.message, parts: [
      { type: 'media', kind: 'audio', media_id: 'channel-audio', url: null },
    ] } } }
    expect(normalizeConversationEvent(input(explicitNull))).toMatchObject({ ok: true, event: { historyOnly: true, attachments: [{ url: null }] } })
    const untrusted = { ...value, data: { ...value.data, message: { ...value.data.message, parts: [
      { type: 'media', kind: 'audio', media_id: 'channel-audio', url: 'https://evil.example/v1/attachments/media_1/content' },
    ] } } }
    expect(normalizeConversationEvent(input(untrusted)).ok).toBe(false)
    expect(buildMessagingReply(input(), 'x'.repeat(4097), 'op').ok).toBe(false)
  })
  it('downloads media only from Linq’s exact attachment route without following redirects', async () => {
    const url = 'https://whatsapp.messages.api.linqapp.com/v1/attachments/media_1/content'
    const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('voice', { status: 200,
      headers: { 'content-type': 'audio/ogg', 'content-length': '5' } }))
    vi.stubGlobal('fetch', send)
    const result = await linqWhatsappConnector.executeRead!({ source, capabilityName: 'attachments.content', args: { url }, idempotencyKey: 'read' })
    expect(result.data).toEqual({ contentType: 'audio/ogg', size: 5, contentBase64: 'dm9pY2U=' })
    expect(send.mock.calls[0]![0]).toBe(url)
    expect(send.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer fixture-brand-key' } })
    await expect(linqWhatsappConnector.executeRead!({ source, capabilityName: 'attachments.content',
      args: { url: 'https://whatsapp.messages.api.linqapp.com.evil.example/v1/attachments/media_1/content' }, idempotencyKey: 'read' })).rejects.toThrow('exact attachment URL')
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('bounds media bytes and surfaces pending capture without returning an error body', async () => {
    const url = 'https://whatsapp.messages.api.linqapp.com/v1/attachments/media_1/content'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret provider response', { status: 409, headers: { 'retry-after': '1' } })))
    await expect(linqWhatsappConnector.executeRead!({ source, capabilityName: 'attachments.content', args: { url }, idempotencyKey: 'read' })).rejects.toMatchObject({ code: 'attachment_pending', definitive: false })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret provider response', { status: 409 })))
    await expect(linqWhatsappConnector.executeRead!({ source, capabilityName: 'attachments.content', args: { url }, idempotencyKey: 'read' })).rejects.toMatchObject({ code: 'capability_outcome_indeterminate', definitive: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret provider response', { status: 429, headers: { 'retry-after': '4' } })))
    await expect(linqWhatsappConnector.executeRead!({ source, capabilityName: 'attachments.content', args: { url }, idempotencyKey: 'read' })).rejects.toMatchObject({ name: 'ProviderRateLimited', status: 429, retryAfterMs: 4_000 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '16000001' } })))
    await expect(linqWhatsappConnector.executeRead!({ source, capabilityName: 'attachments.content', args: { url }, idempotencyKey: 'read' })).rejects.toThrow('byte limit')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('retry', { status: 408 })))
    await expect(linqWhatsappConnector.executeRead!({ source, capabilityName: 'attachments.content', args: { url }, idempotencyKey: 'read' })).rejects.toMatchObject({
      code: 'provider_http_error', definitive: false,
    })
  })
  it('lists each supported transport once without implying account readiness', () => {
    const channels = listConversationChannels()
    expect(channels.some(c => c.providerId === 'linq-whatsapp' && c.transport === 'whatsapp')).toBe(true)
    expect(channels.some(c => c.providerId === 'email' && c.sourceKind === 'channel')).toBe(true)
    expect(new Set(channels.map(c => `${c.providerId}:${c.eventType}`)).size).toBe(channels.length)
    channels.length = 0
    expect(listConversationChannels().length).toBeGreaterThan(0)
  })
  it('verifies raw bytes and deduplicates using the existing router', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const deliver = vi.fn()
    const router = new WebhookRouter({ providers: [linqWhatsappWebhookProvider], runtime: 'test', resolveSecret: () => secret, deliver })
    const rawBody = JSON.stringify(payload()), request = { providerId: 'linq-whatsapp', rawBody, headers: headers(rawBody) }
    expect((await router.handle(request)).status).toBe(200)
    expect((await router.handle(request)).status).toBe(200)
    expect(deliver).toHaveBeenCalledTimes(1)
    expect((await router.handle({ ...request, rawBody: rawBody + ' ' })).status).toBe(401)
    expect((await router.handle({ ...request, headers: headers(rawBody, 'event-1', now / 1000 - 301) })).status).toBe(401)
    const mismatch = await router.handle({ ...request, headers: headers(rawBody, 'different-id') })
    expect(mismatch.status).toBeGreaterThanOrEqual(400)
    expect(deliver).toHaveBeenCalledTimes(1)
  })
})
