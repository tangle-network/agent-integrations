import { declarativeRestConnector } from './declarative-rest.js'

const id = { type: 'string', minLength: 1, maxLength: 256 }
const page = { cursor: id, limit: { type: 'integer', minimum: 1, maximum: 100 } }

/** WhatsApp is a separate Linq service and credential, not a transport flag on v3. */
const base = declarativeRestConnector({
  kind: 'linq-whatsapp', displayName: 'Linq WhatsApp', category: 'comms',
  description: 'Use an existing WhatsApp Business identity. Reads expose current window, template and delivery state; sends acknowledge acceptance only.',
  auth: { kind: 'api-key', hint: 'The exact brand-scoped WhatsApp key from Linq Embedded Signup. Keep the issued test/live prefix unchanged.' },
  baseUrl: 'https://whatsapp.messages.api.linqapp.com/v1',
  defaultConsistencyModel: 'advisory', credentialsExpiredStatuses: [401],
  test: { method: 'GET', path: '/phone_numbers' },
  capabilities: [
    { name: 'numbers.list', class: 'read', description: 'Read existing registered sending numbers. Does not acquire a number.',
      parameters: { type: 'object', properties: {} }, request: { method: 'GET', path: '/phone_numbers' } },
    { name: 'chats.list', class: 'read', description: 'Find the existing one-to-one conversation and its pinned sending number.',
      parameters: { type: 'object', properties: page },
      request: { method: 'GET', path: '/chats', query: { cursor: '{cursor}', limit: '{limit}' } } },
    { name: 'chats.get', class: 'read', description: 'Read the actual customer, sender and current free-form messaging window.',
      parameters: { type: 'object', properties: { chat_id: id }, required: ['chat_id'] },
      request: { method: 'GET', path: '/chats/{chat_id}' } },
    { name: 'events.list', class: 'read', description: 'Read the account event log. Keep its opaque cursor separate from chat sequence numbers.',
      parameters: { type: 'object', properties: page },
      request: { method: 'GET', path: '/event_log', query: { cursor: '{cursor}', limit: '{limit}' } } },
    { name: 'chats.events', class: 'read', description: 'Read canonical messages and delivery receipts in the selected chat.',
      parameters: { type: 'object', properties: { chat_id: id, ...page }, required: ['chat_id'] },
      request: { method: 'GET', path: '/chats/{chat_id}/events', query: { cursor: '{cursor}', limit: '{limit}' } } },
    { name: 'templates.list', class: 'read', description: 'Read approved templates and their exact send_schema; no template is inferred or substituted.',
      parameters: { type: 'object', properties: {} }, request: { method: 'GET', path: '/templates' } },
    { name: 'messages.reply', class: 'mutation', cas: 'native-idempotency', externalEffect: true,
      description: 'Reply in the existing chat without changing its sender or recipient. Free-form text requires an open customer window; a refusal does not authorize template substitution.',
      parameters: { type: 'object', properties: { chat_id: id, text: { type: 'string', minLength: 1, maxLength: 4096 } }, required: ['chat_id', 'text'] },
      request: { method: 'POST', path: '/chats/{chat_id}/messages', headers: { 'Idempotency-Key': '{requestKey}' },
        body: { parts: [{ type: 'text', body: '{text}' }] } } },
  ],
})

export const linqWhatsappConnector: typeof base = {
  ...base,
  async executeMutation(inv) {
    if (!inv.idempotencyKey || inv.idempotencyKey.length > 255 || !/^[\x21-\x7e]+$/.test(inv.idempotencyKey)) {
      throw new Error('Linq WhatsApp requires a bounded stable operation key')
    }
    // The execution identity is host-owned, never a model-authored header.
    return base.executeMutation!({ ...inv, args: { ...inv.args, requestKey: inv.idempotencyKey } })
  },
}
