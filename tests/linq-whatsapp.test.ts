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
    expect(buildMessagingReply(input(), 'Found two', 'op')).toEqual({ ok: true, reply: { action: 'linq-whatsapp.messages.reply', input: { chat_id: 'chat-1', text: 'Found two' } } })
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
  it('requires text handling rather than silently dropping attachments', () => {
    const value = { ...payload(), data: { ...payload().data, message: { ...payload().data.message, parts: [{ type: 'media', media_id: 'opaque' }] } } }
    expect(normalizeConversationEvent(input(value)).ok).toBe(false)
    expect(buildMessagingReply(input(), 'x'.repeat(4097), 'op').ok).toBe(false)
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
    const router = new WebhookRouter({ providers: [linqWhatsappWebhookProvider], runtime: 'fixture', resolveSecret: () => secret, deliver })
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
