import { declarativeRestConnector } from './declarative-rest.js'

const id = { type: 'string', minLength: 1, maxLength: 256 }
const text = { type: 'string', minLength: 1, maxLength: 18000 }
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }
const mailPage = { cursor: id, limit: page.limit }

/** Identity-scoped API key recommended. Subscription secrets stay in the host vault, never tools. */
export const inkboxConnector = declarativeRestConnector({
  kind: 'inkbox', displayName: 'Inkbox', category: 'comms',
  description: 'Use an existing agent identity for email, SMS and iMessage. A send is provider acceptance, not delivery.',
  auth: { kind: 'api-key', hint: 'Claimed, identity-scoped Inkbox X-API-Key. Do not give agents an organization admin key.' },
  credentialPlacement: { kind: 'header', header: 'X-API-Key' },
  baseUrl: 'https://inkbox.ai/api/v1', defaultConsistencyModel: 'advisory',
  test: { method: 'GET', path: '/identities/self/channel-status' },
  capabilities: [
    { name: 'identity.status', class: 'read', description: 'Read the connected identity and channel readiness.',
      parameters: { type: 'object', properties: {} }, request: { method: 'GET', path: '/identities/self/channel-status' } },
    { name: 'imessage.conversations', class: 'read', description: 'List iMessage conversations with offset pagination.',
      parameters: { type: 'object', properties: page },
      request: { method: 'GET', path: '/imessage/conversations', query: { offset: '{offset}', limit: '{limit}' } } },
    { name: 'imessage.messages', class: 'read', description: 'Read messages in an existing iMessage conversation.',
      parameters: { type: 'object', properties: { conversation_id: id, ...page }, required: ['conversation_id'] },
      request: { method: 'GET', path: '/imessage/messages', query: { conversation_id: '{conversation_id}', offset: '{offset}', limit: '{limit}' } } },
    { name: 'imessage.reply', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Reply to an existing iMessage conversation. Do not blindly retry an uncertain send.',
      parameters: { type: 'object', properties: { conversation_id: id, text }, required: ['conversation_id', 'text'] },
      request: { method: 'POST', path: '/imessage/messages', body: { conversation_id: '{conversation_id}', text: '{text}' } } },
    { name: 'email.list', class: 'read', description: 'List messages in the connected identity mailbox.',
      parameters: { type: 'object', properties: { email_address: id, ...mailPage }, required: ['email_address'] },
      request: { method: 'GET', path: '/mail/mailboxes/{email_address}/messages', query: { cursor: '{cursor}', limit: '{limit}' } } },
    { name: 'email.get', class: 'read', description: 'Read the complete stored message before acting on a truncated webhook body.',
      parameters: { type: 'object', properties: { email_address: id, message_id: id }, required: ['email_address', 'message_id'] },
      request: { method: 'GET', path: '/mail/mailboxes/{email_address}/messages/{message_id}' } },
    { name: 'email.send', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Send plain-text email; retain the returned message id. The mailbox is the sender, not a model-authored From header.',
      parameters: { type: 'object', properties: { email_address: id, to: { type: 'array', minItems: 1, maxItems: 50, items: id },
        subject: { type: 'string', maxLength: 998 }, text, in_reply_to_message_id: id }, required: ['email_address', 'to', 'subject', 'text'] },
      request: { method: 'POST', path: '/mail/mailboxes/{email_address}/messages',
        body: { recipients: { to: '{to}' }, subject: '{subject}', body_text: '{text}', in_reply_to_message_id: '{in_reply_to_message_id}' } } },
    { name: 'sms.reply', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Reply in an existing SMS/MMS conversation from an owned phone number. Provider opt-in rules still apply.',
      parameters: { type: 'object', properties: { phone_number_id: id, conversation_id: id, text: { ...text, maxLength: 1600 } }, required: ['phone_number_id', 'conversation_id', 'text'] },
      request: { method: 'POST', path: '/phone/numbers/{phone_number_id}/texts', body: { conversation_id: '{conversation_id}', text: '{text}' } } },
    { name: 'sms.list', class: 'read', description: 'List phone messages for reconciliation after a missed webhook.',
      parameters: { type: 'object', properties: { phone_number_id: id, ...page }, required: ['phone_number_id'] },
      request: { method: 'GET', path: '/phone/numbers/{phone_number_id}/texts', query: { offset: '{offset}', limit: '{limit}' } } },
  ],
})
