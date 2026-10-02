import { afterEach, expect, it, vi } from 'vitest'
import { buildMessagingMediaReply } from '../src/conversation-events/index.js'
import { linqConnector } from '../src/connectors/adapters/linq.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const payload = {
  event_id: 'event-1', event_type: 'message.received', webhook_version: '2026-02-03',
  created_at: '2026-10-02T00:00:00.000Z', data: {
    id: 'message-1', direction: 'inbound', service: 'iMessage',
    chat: { id: 'owned-chat', is_group: false, owner_handle: { handle: '+15550000002', is_me: true } },
    sender_handle: { handle: '+15550000001', is_me: false },
    parts: [{ type: 'text', value: 'Show me the image' }],
  },
}
const event = (source: unknown = payload) => ({ provider: 'linq', type: 'linq.message.received', payload: source })
const media = { url: 'https://assets.example.com/generated/image.png?signature=abc' }

afterEach(() => vi.unstubAllGlobals())

it('plans one media send to the chat from the stored event with one stable key and body', async () => {
  const first = buildMessagingMediaReply(event(), media, 'line-media:message-2')
  expect(first).toEqual({ ok: true, reply: {
    idempotencyKey: 'line-media:message-2', action: 'linq.messages.media.reply',
    input: { chat_id: 'owned-chat', url: media.url, message_key: 'line-media:message-2' },
  } })
  expect(buildMessagingMediaReply(event(), media, 'line-media:message-2')).toEqual(first)
  if (!first.ok) throw new Error('Expected a media reply plan')

  const request = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'accepted' }))
  vi.stubGlobal('fetch', request)
  const source: ResolvedDataSource = { id: 'source', projectId: 'project', publishedAgentId: null,
    kind: 'linq', label: 'linq', consistencyModel: 'advisory', scopes: [], metadata: {},
    credentials: { kind: 'api-key', apiKey: 'fixture-secret' }, status: 'active' }
  await linqConnector.executeMutation!({ source, capabilityName: 'messages.media.reply',
    args: first.reply.input, idempotencyKey: first.reply.idempotencyKey })
  expect(request).toHaveBeenCalledTimes(1)
  expect(String(request.mock.calls[0]?.[0])).toBe('https://api.linqapp.com/api/partner/v3/chats/owned-chat/messages')
  expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
    message: { parts: [{ type: 'media', url: media.url }], idempotency_key: 'line-media:message-2' },
  })
})

it('rejects other providers, outbound echoes, old history, groups and missing chat authority', () => {
  expect(buildMessagingMediaReply({ provider: 'inkbox', type: 'inkbox.message.received', payload: {} }, media, 'op').ok).toBe(false)
  for (const data of [
    { direction: 'outbound' }, { reconciled_at: '2026-10-02T00:00:00.000Z' },
    { chat: { ...payload.data.chat, is_group: true } },
    { chat: { ...payload.data.chat, id: '' } },
    { chat: { ...payload.data.chat, owner_handle: { handle: '+15550000002', is_me: false } } },
    { chat: { ...payload.data.chat, id: 'x'.repeat(257) } },
  ]) {
    expect(buildMessagingMediaReply(event({ ...payload, data: { ...payload.data, ...data } }), media, 'op').ok).toBe(false)
  }
})

it('rejects unsafe media descriptors and unstable operation keys', () => {
  for (const url of [
    'http://assets.example.com/image.png', 'https://user:pass@assets.example.com/image.png',
    'https://assets.example.com/image.png#fragment', 'https://assets.example.com/image.png\n',
    'https://', 'https://localhost/image.png', 'https://private.local/image.png',
    'https://127.0.0.1/image.png', 'https://[::1]/image.png',
    `https://assets.example.com/${'a'.repeat(2048)}`,
  ]) {
    expect(buildMessagingMediaReply(event(), { url }, 'op').ok).toBe(false)
  }
  const modelSelectedChat = { ...media, chat_id: 'model-selected-chat' }
  expect(buildMessagingMediaReply(event(), modelSelectedChat, 'op').ok).toBe(false)
  let reads = 0
  const changingUrl = { get url() { return reads++ === 0 ? media.url : 'http://unsafe.example.com/image.png' } }
  expect(buildMessagingMediaReply(event(), changingUrl, 'op')).toMatchObject({
    ok: true, reply: { input: { url: media.url } },
  })
  expect(reads).toBe(1)
  for (const key of ['', 'unstable\nkey', 'x'.repeat(256)]) {
    expect(buildMessagingMediaReply(event(), media, key).ok).toBe(false)
  }
})
