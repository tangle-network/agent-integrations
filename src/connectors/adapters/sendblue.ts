import { declarativeRestConnector } from './declarative-rest.js'

const e164 = { type: 'string', pattern: '^\\+[1-9]\\d{6,14}$', maxLength: 16 }
const id = { type: 'string', minLength: 1, maxLength: 256 }
const content = { type: 'string', minLength: 1, maxLength: 10000 }
const mediaUrl = { type: 'string', format: 'uri', pattern: '^https://', maxLength: 8192 }

/** API keys are a pair; both stay in the encrypted credential envelope. */
export const sendblueConnector = declarativeRestConnector({
  kind: 'sendblue', displayName: 'Sendblue', category: 'comms',
  description: 'Read owned lines and messages; send replies from pinned numbers and iMessage presence. Sendblue may fall back to SMS.',
  auth: { kind: 'api-key', hint: 'JSON with apiKeyId and apiSecretKey; use a server-side Sendblue account key.' },
  credentialPlacement: { kind: 'structured-headers', fields: {
    apiKeyId: 'sb-api-key-id', apiSecretKey: 'sb-api-secret-key',
  } },
  baseUrl: 'https://api.sendblue.com', defaultConsistencyModel: 'advisory',
  test: { method: 'GET', path: '/api/v2/lines/state' },
  capabilities: [
    { name: 'lines.state', class: 'read', description: 'Read the authenticated account line-state snapshot without buying a number.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/api/v2/lines/state' } },
    { name: 'recipient.service', class: 'read', description: 'Check a recipient service before a send that must stay on iMessage.',
      parameters: { type: 'object', properties: { number: e164 }, required: ['number'] },
      request: { method: 'GET', path: '/api/evaluate-service', query: { number: '{number}' } } },
    { name: 'messages.list', class: 'read', description: 'Reconcile messages on an explicitly selected owned line.',
      parameters: { type: 'object', properties: { sendblue_number: e164,
        is_outbound: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0 } }, required: ['sendblue_number'] },
      request: { method: 'GET', path: '/api/v2/messages', query: { sendblue_number: '{sendblue_number}',
        is_outbound: '{is_outbound}', limit: '{limit}', offset: '{offset}' } } },
    { name: 'messages.get', class: 'read', description: 'Read one account-owned message by its public handle.',
      parameters: { type: 'object', properties: { message_handle: id }, required: ['message_handle'] },
      request: { method: 'GET', path: '/api/v2/messages/{message_handle}' } },
    { name: 'messages.send', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Send from an explicitly selected owned number. Reconcile uncertain outcomes before retrying.',
      parameters: { type: 'object', properties: { from_number: e164, number: e164, content, media_url: mediaUrl,
        reply_to: { type: 'object', properties: { message_handle: id }, required: ['message_handle'], additionalProperties: false } },
        required: ['from_number', 'number', 'content'] },
      request: { method: 'POST', path: '/api/send-message', body: {
        from_number: '{from_number}', number: '{number}', content: '{content}', media_url: '{media_url}', reply_to: '{reply_to}',
      } } },
    { name: 'messages.send_media', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Send a media-only message from a pinned number; reconcile uncertain outcomes before retrying.',
      parameters: { type: 'object', properties: { from_number: e164, number: e164, media_url: mediaUrl },
        required: ['from_number', 'number', 'media_url'] },
      request: { method: 'POST', path: '/api/send-message', body: {
        from_number: '{from_number}', number: '{number}', media_url: '{media_url}',
      } } },
    { name: 'messages.react', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Add one named tapback to an inbound iMessage using its primary message handle.',
      parameters: { type: 'object', properties: { from_number: e164, message_handle: id,
        reaction: { type: 'string', enum: ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'] } },
        required: ['from_number', 'message_handle', 'reaction'] },
      request: { method: 'POST', path: '/api/send-reaction', body: {
        from_number: '{from_number}', message_handle: '{message_handle}', reaction: '{reaction}',
      } } },
    { name: 'typing.send', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Start or stop a one-to-one iMessage typing indicator on an owned line.',
      parameters: { type: 'object', properties: { from_number: e164, number: e164,
        state: { type: 'string', enum: ['start', 'stop'] },
        max_duration_ms: { type: 'integer', minimum: 1, maximum: 300000 } },
        required: ['from_number', 'number', 'state'] },
      request: { method: 'POST', path: '/api/send-typing-indicator', body: {
        from_number: '{from_number}', number: '{number}', state: '{state}', max_duration_ms: '{max_duration_ms}',
      } } },
    { name: 'read_receipts.send', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Ask a supported owned line to mark a one-to-one conversation read; account activation and actual delivery must be checked separately.',
      parameters: { type: 'object', properties: { from_number: e164, number: e164 },
        required: ['from_number', 'number'] },
      request: { method: 'POST', path: '/api/mark-read', body: {
        from_number: '{from_number}', number: '{number}',
      } } },
    { name: 'groups.get', class: 'read', description: 'Read the current members of an account-owned group before a group send.',
      parameters: { type: 'object', properties: { group_id: id }, required: ['group_id'] },
      request: { method: 'GET', path: '/api/v2/groups/{group_id}' } },
    { name: 'groups.send', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Send to a pinned existing group after the host checks every current member.',
      parameters: { type: 'object', properties: { group_id: id, from_number: e164, content, media_url: mediaUrl },
        required: ['group_id', 'from_number', 'content'] },
      request: { method: 'POST', path: '/api/send-group-message', body: {
        group_id: '{group_id}', from_number: '{from_number}', content: '{content}', media_url: '{media_url}',
      } } },
    { name: 'groups.send_media', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Send media to a pinned existing group after the host checks every current member.',
      parameters: { type: 'object', properties: { group_id: id, from_number: e164, media_url: mediaUrl },
        required: ['group_id', 'from_number', 'media_url'] },
      request: { method: 'POST', path: '/api/send-group-message', body: {
        group_id: '{group_id}', from_number: '{from_number}', media_url: '{media_url}',
      } } },
  ],
})
