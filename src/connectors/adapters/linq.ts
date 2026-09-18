import { declarativeRestConnector } from './declarative-rest.js'

const id = { type: 'string', minLength: 1, maxLength: 256 }
const page = { cursor: id, limit: { type: 'integer', minimum: 1, maximum: 100 } }

export const linqConnector = declarativeRestConnector({
  kind: 'linq', displayName: 'Linq', category: 'comms',
  description: 'Read owned messaging lines and conversations, and send replies through Linq v3.',
  auth: { kind: 'api-key', hint: 'Linq partner API bearer key. Webhook signing secrets are configured separately.' },
  baseUrl: 'https://api.linqapp.com/api/partner/v3', defaultConsistencyModel: 'advisory',
  test: { method: 'GET', path: '/phone_numbers' },
  capabilities: [
    { name: 'numbers.list', class: 'read', description: 'List owned lines and their current provider status.',
      parameters: { type: 'object', properties: {} }, request: { method: 'GET', path: '/phone_numbers' } },
    { name: 'chats.list', class: 'read', description: 'List account conversations with pagination.',
      parameters: { type: 'object', properties: page },
      request: { method: 'GET', path: '/chats', query: { cursor: '{cursor}', limit: '{limit}' } } },
    { name: 'chats.get', class: 'read', description: 'Read a conversation and its actual owner handle before selecting a reply route.',
      parameters: { type: 'object', properties: { chat_id: id }, required: ['chat_id'] },
      request: { method: 'GET', path: '/chats/{chat_id}' } },
    { name: 'messages.list', class: 'read', description: 'Read conversation messages for context or delivery reconciliation.',
      parameters: { type: 'object', properties: { chat_id: id, ...page }, required: ['chat_id'] },
      request: { method: 'GET', path: '/chats/{chat_id}/messages', query: { cursor: '{cursor}', limit: '{limit}' } } },
    { name: 'messages.reply', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Send a plain-text reply to a verified conversation. Supply the same message_key on recovery; never manufacture a new key after a timeout.',
      parameters: { type: 'object', properties: { chat_id: id, text: { type: 'string', minLength: 1, maxLength: 10000 }, message_key: id },
        required: ['chat_id', 'text', 'message_key'] },
      request: { method: 'POST', path: '/chats/{chat_id}/messages', body: {
        message: { parts: [{ type: 'text', value: '{text}' }], idempotency_key: '{message_key}' },
      } } },
  ],
})
