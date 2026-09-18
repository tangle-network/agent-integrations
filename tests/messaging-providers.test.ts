import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inkboxWebhookProvider, linqWebhookProvider, contiguityWebhookProvider, verifyInkboxWebhook, verifyLinqWebhook } from '../src/webhooks/messaging.js'
import { normalizeConversationEvent, buildMessagingReply } from '../src/conversation-events/index.js'
import { WebhookRouter } from '../src/webhooks/router.js'
import { inkboxConnector } from '../src/connectors/adapters/inkbox.js'
import { linqConnector } from '../src/connectors/adapters/linq.js'
import { contiguityConnector } from '../src/connectors/adapters/contiguity.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const now = 1800000000000
const iso = new Date(now).toISOString()
const secret = 'literal-test-signing-key-never-a-credential'
const linqSecret = `whsec_${Buffer.alloc(32, 7).toString('base64')}`
const fixtures = {
  inkbox: { id: 'evt-i', event_type: 'imessage.received', timestamp: iso, data: { message: {
    id: 'msg-i', conversation_id: 'conversation-i', direction: 'inbound', sender_number: '+15550000001',
    content: 'Find a desk', created_at: iso, is_group: false, media: null,
  } } },
  linq: { event_id: 'evt-l', event_type: 'message.received', webhook_version: '2026-02-03', created_at: iso, data: {
    id: 'msg-l', direction: 'inbound', chat: { id: 'chat-l', is_group: false, owner_handle: { handle: '+15550000002', is_me: true } },
    sender_handle: { handle: '+15550000001', is_me: false }, parts: [{ type: 'text', value: 'Find a desk' }],
  } },
  contiguity: { id: 'evt-c', type: 'imessage.incoming', timestamp: now / 1000, data: {
    from: '+15550000001', to: '+15550000002', body: 'Find a desk', timestamp: now / 1000, attachments: [],
  } },
}
const providers = { inkbox: inkboxWebhookProvider, linq: linqWebhookProvider, contiguity: contiguityWebhookProvider }
type Provider = keyof typeof providers
const hmac = (key: string | Buffer, text: string, format: 'hex' | 'base64' = 'hex') => createHmac('sha256', key).update(text).digest(format)
function headers(provider: Provider, raw: string, ts = now / 1000): Record<string, string> {
  if (provider === 'inkbox') return { 'x-inkbox-request-id': 'request', 'x-inkbox-timestamp': String(ts), 'x-inkbox-signature': `sha256=${hmac(secret, `request.${ts}.${raw}`)}` }
  if (provider === 'linq') return { 'webhook-id': 'request', 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${hmac(Buffer.alloc(32, 7), `request.${ts}.${raw}`, 'base64')}` }
  return { 'contiguity-signature': `t=${ts},v1=${hmac(secret, `${ts}.${raw}`)}` }
}
function input(provider: Provider, payload: unknown = fixtures[provider]) {
  const raw = payload as Record<string, unknown>
  return { provider, type: `${provider}.${raw.event_type ?? raw.type}`, payload }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe.each(Object.keys(providers) as Provider[])('%s verified ingress', (provider) => {
  it('verifies exact bytes, normalizes and deduplicates through the existing router', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const rawBody = JSON.stringify(fixtures[provider])
    const delivered: unknown[] = []
    const router = new WebhookRouter({ providers: [providers[provider]], runtime: 'test',
      resolveSecret: () => provider === 'linq' ? linqSecret : secret,
      deliver: async (event) => {
        const normalized = normalizeConversationEvent({ provider: event.provider, type: event.eventType, payload: event.payload })
        expect(normalized.ok).toBe(true); delivered.push(normalized)
      },
    })
    const request = { providerId: provider, rawBody, headers: headers(provider, rawBody) }
    expect((await router.handle(request)).status).toBe(200)
    expect((await router.handle(request)).status).toBe(200)
    expect(delivered).toHaveLength(1)
    expect((await router.handle({ ...request, rawBody: rawBody + ' ' })).status).toBe(401)
  })
  it.each([-301, 301])('rejects a correctly signed event %i seconds away', (skew) => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const rawBody = JSON.stringify(fixtures[provider])
    expect(providers[provider].verifySignature({ rawBody, headers: headers(provider, rawBody, now / 1000 + skew), secret: provider === 'linq' ? linqSecret : secret }).valid).toBe(false)
  })
  it('rejects missing, repeated and wrong-key signatures', () => {
    vi.useFakeTimers(); vi.setSystemTime(now)
    const rawBody = JSON.stringify(fixtures[provider]); const hs = headers(provider, rawBody)
    const key = Object.keys(hs).find((k) => k.endsWith('signature'))!
    expect(providers[provider].verifySignature({ rawBody, headers: {}, secret }).valid).toBe(false)
    expect(providers[provider].verifySignature({ rawBody, headers: hs, secret: 'wrong' }).valid).toBe(false)
    expect(providers[provider].verifySignature({ rawBody, headers: { ...hs, [key.toUpperCase()]: hs[key]! }, secret: provider === 'linq' ? linqSecret : secret }).valid).toBe(false)
  })
  it('derives replies from recorded peers, not model-selected destinations', () => {
    const result = buildMessagingReply(input(provider), 'Found two options', 'stable-operation')
    expect(result.ok).toBe(true)
    if (result.ok) expect(JSON.stringify(result.reply.input)).not.toContain('credential')
    // Every retry of this reply must reuse the caller's key, whatever the provider.
    if (result.ok) expect(result.reply.idempotencyKey).toBe('stable-operation')
  })
  it('does not interpret delivery status as a new user instruction', () => {
    const changed = { ...fixtures[provider], event_type: 'message.delivered', type: 'message.delivered' }
    expect(normalizeConversationEvent(input(provider, changed)).ok).toBe(false)
  })
})

it('does not confuse provider signing formats', () => {
  const raw = '{}', ts = now / 1000
  expect(verifyInkboxWebhook(raw, headers('linq', raw), secret, ts)).toBe(false)
  expect(verifyLinqWebhook(raw, headers('inkbox', raw), linqSecret, ts)).toBe(false)
  expect(verifyLinqWebhook(raw, headers('linq', raw), 'whsec_bad!', ts)).toBe(false)
})
it('accepts Linq key rotation signature lists', () => {
  const raw = '{}', hs = headers('linq', raw)
  expect(verifyLinqWebhook(raw, { ...hs, 'webhook-signature': `v1,${'x'.repeat(44)} ${hs['webhook-signature']}` }, linqSecret, now / 1000)).toBe(true)
})
it('keeps reconciled Linq history out of automatic replies', () => {
  const fixture = { ...fixtures.linq, data: { ...fixtures.linq.data, reconciled_at: iso } }
  expect(buildMessagingReply(input('linq', fixture), 'reply', 'op').ok).toBe(false)
})
it('rejects future unreviewed Linq webhook versions', () => {
  expect(normalizeConversationEvent(input('linq', { ...fixtures.linq, webhook_version: 'unknown' })).ok).toBe(false)
})
it('rejects outbound Linq echoes', () => {
  const fixture = structuredClone(fixtures.linq); fixture.data.direction = 'outbound'
  expect(normalizeConversationEvent(input('linq', fixture)).ok).toBe(false)
})
it('does not treat group participant snapshots as authority to reply', () => {
  const fixture = structuredClone(fixtures.inkbox); fixture.data.message.is_group = true
  expect(buildMessagingReply(input('inkbox', fixture), 'reply', 'op').ok).toBe(false)
})
it('keeps Contiguity number pairs and transports distinct', () => {
  const a = normalizeConversationEvent(input('contiguity'))
  const b = normalizeConversationEvent(input('contiguity', { ...fixtures.contiguity, type: 'text.incoming.sms' }))
  expect(a.ok && b.ok && a.event.conversationId !== b.event.conversationId).toBe(true)
})
it('requires explicit owned phone id for Inkbox SMS replies', () => {
  const message = { id: 'sms', conversation_id: 'sms-chat', direction: 'inbound', sender_phone_number: '+15550000001', local_phone_number: '+15550000002', text: 'Hello', created_at: iso }
  const fixture = { id: 'evt', event_type: 'text.received', data: { text_message: message } }
  expect(normalizeConversationEvent(input('inkbox', fixture)).ok).toBe(true)
  expect(buildMessagingReply(input('inkbox', fixture), 'Hello', 'op').ok).toBe(false)
  expect(buildMessagingReply(input('inkbox', { ...fixture, data: { text_message: { ...message, phone_number_id: 'phone' } } }), 'Hello', 'op')).toMatchObject({ ok: true, reply: { action: 'inkbox.sms.reply', input: { phone_number_id: 'phone', conversation_id: 'sms-chat' } } })
})
it('replies to one email sender without propagating BCC', () => {
  const fixture = { id: 'mail-evt', event_type: 'message.received', timestamp: iso, data: { message: { id: 'mail-id', thread_id: 'thread-id', direction: 'inbound', from_address: 'peer@example.com', email_address: 'agent@example.com', body: 'Hello', body_state: 'complete', subject: 'Desk', bcc_addresses: ['secret@example.com'] } } }
  expect(buildMessagingReply(input('inkbox', fixture), 'Here are options', 'op')).toMatchObject({ ok: true, reply: { action: 'inkbox.email.send', input: { to: ['peer@example.com'], email_address: 'agent@example.com', in_reply_to_message_id: 'mail-id', subject: 'Re: Desk' } } })
  fixture.data.message.body_state = 'truncated'
  expect(buildMessagingReply(input('inkbox', fixture), 'reply', 'op').ok).toBe(false)
})
it('rejects dangerous attachment references without fetching them', () => {
  const fixture = { ...fixtures.inkbox, data: { message: { ...fixtures.inkbox.data.message, media: [{ url: 'http://169.254.169.254/secret' }] } } }
  expect(normalizeConversationEvent(input('inkbox', fixture)).ok).toBe(false)
  fixture.data.message.media = Array.from({ length: 51 }, () => ({ url: 'https://example.com/file' }))
  expect(normalizeConversationEvent(input('inkbox', fixture)).ok).toBe(false)
})

const source = (kind: string): ResolvedDataSource => ({ id: 'source', projectId: 'project', publishedAgentId: null, kind, label: kind, consistencyModel: 'advisory', scopes: [], metadata: {}, credentials: { kind: 'api-key', apiKey: 'fixture-secret' }, status: 'active' })
describe('documented outbound provider contracts', () => {
  it.each([
    ['inkbox', inkboxConnector, 'imessage.reply', { conversation_id: 'chat', text: 'Hello' }, 'https://inkbox.ai/api/v1/imessage/messages', { conversation_id: 'chat', text: 'Hello' }],
    ['linq', linqConnector, 'messages.reply', { chat_id: 'chat', text: 'Hello', message_key: 'operation' }, 'https://api.linqapp.com/api/partner/v3/chats/chat/messages', { message: { parts: [{ type: 'text', value: 'Hello' }], idempotency_key: 'operation' } }],
    ['contiguity', contiguityConnector, 'messages.send_imessage', { to: '+15550000001', from: '+15550000002', message: 'Hello' }, 'https://api.contiguity.com/send/imessage', { to: '+15550000001', from: '+15550000002', message: 'Hello' }],
  ] as const)('%s uses its documented API shape', async (kind, adapter, capabilityName, args, url, body) => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'accepted' }))
    vi.stubGlobal('fetch', request)
    const result = await adapter.executeMutation!({ source: source(kind), capabilityName, args: { ...args }, idempotencyKey: 'operation' })
    expect(request).toHaveBeenCalledTimes(1)
    expect(String(request.mock.calls[0]![0])).toBe(url)
    const init = request.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual(body)
    const hs = new Headers(init.headers)
    expect(kind === 'inkbox' ? hs.get('x-api-key') : hs.get('authorization')).toBe(kind === 'inkbox' ? 'fixture-secret' : 'Bearer fixture-secret')
    expect(result.status).toBe('committed') // Adapter acceptance, not delivery.
  })
  it('propagates an uncertain send without retrying', async () => {
    const request = vi.fn(async () => { throw new Error('connection reset after write') }); vi.stubGlobal('fetch', request)
    await expect(inkboxConnector.executeMutation!({ source: source('inkbox'), capabilityName: 'imessage.reply', args: { conversation_id: 'chat', text: 'Hello' }, idempotencyKey: 'operation' })).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('does not expose number purchasing or signing key rotation to an agent', () => {
    for (const adapter of [inkboxConnector, linqConnector, contiguityConnector]) {
      expect(adapter.manifest.capabilities.some((c) => /purchase|provision|rotate|lease/.test(c.name))).toBe(false)
      expect(adapter.manifest.capabilities.filter((c) => c.class === 'mutation').every((c) => c.class === 'mutation' && c.externalEffect === true)).toBe(true)
    }
  })
})
