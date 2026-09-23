import type { ConnectorAdapter, ConnectorInvocation } from '../types.js'
import { declarativeRestConnector, executeRestRequest, mutationResultFromTransport, type RestConnectorSpec } from './declarative-rest.js'

const id = { type: 'string', minLength: 1, maxLength: 256 }
const text = { type: 'string', minLength: 1, maxLength: 18000 }
const page = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }
const mailPage = { cursor: id, limit: page.limit }
const E164 = /^\+[1-9]\d{7,14}$/
const e164 = { type: 'string', pattern: E164.source }
const urlMaxLength = 2048

/** Identity-scoped API key recommended. Subscription secrets stay in the host vault, never tools. */
const spec: RestConnectorSpec = {
  kind: 'inkbox', displayName: 'Inkbox', category: 'comms',
  description: 'Use an existing agent identity for email, SMS, iMessage and phone calls. A send is provider acceptance, not delivery.',
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
    // The identity-scoped key configures its own identity, so agent_identity_id is never sent.
    // Only webhook and auto_reject are exposed: forward, auto_accept and hosted_agent route calls elsewhere.
    { name: 'phone.incoming_call_action.set', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Set how the connected identity handles inbound calls: send an incoming-call webhook to an HTTPS URL, or reject every call.',
      parameters: { type: 'object', additionalProperties: false, properties: {
        incoming_call_action: { type: 'string', enum: ['webhook', 'auto_reject'] },
        incoming_call_webhook_url: { type: ['string', 'null'], format: 'uri', pattern: '^https://', maxLength: urlMaxLength,
          description: 'Required HTTPS URL when incoming_call_action is webhook; null or absent for auto_reject.' },
      }, required: ['incoming_call_action'] },
      request: { method: 'PUT', path: '/phone/incoming-call-action',
        body: { incoming_call_action: '{incoming_call_action}', incoming_call_webhook_url: '{incoming_call_webhook_url}' } } },
    // Always a dedicated-number call driven over the caller's media WebSocket; Voice AI, reason and voicemail fields are not exposed.
    { name: 'phone.call.place', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Place an outbound call from an owned number and stream it to a wss:// media WebSocket. Returns the call object; retain its id. Do not blindly retry an uncertain call.',
      parameters: { type: 'object', additionalProperties: false, properties: {
        from_number: e164, to_number: e164,
        client_websocket_url: { type: 'string', format: 'uri', pattern: '^wss://', maxLength: urlMaxLength },
      }, required: ['from_number', 'to_number', 'client_websocket_url'] },
      request: { method: 'POST', path: '/phone/place-call',
        body: { origination: 'dedicated_number', mode: 'client_websocket', from_number: '{from_number}', to_number: '{to_number}', client_websocket_url: '{client_websocket_url}' } } },
  ],
}

const base = declarativeRestConnector(spec)
const baseMutation = base.executeMutation!

export const inkboxConnector: ConnectorAdapter = {
  ...base,
  async executeMutation(inv: ConnectorInvocation) {
    if (inv.capabilityName === 'phone.incoming_call_action.set') return setIncomingCallAction(inv)
    if (inv.capabilityName === 'phone.call.place') return baseMutation({ ...inv, args: placeCallArgs(inv.args) })
    return baseMutation(inv)
  },
}

/** Sends the webhook URL as explicit null for auto_reject: Inkbox replaces saved URL fields on every PUT. */
async function setIncomingCallAction(inv: ConnectorInvocation) {
  const args = allowOnly(inv.args, ['incoming_call_action', 'incoming_call_webhook_url'])
  const action = args.incoming_call_action
  const webhookUrl = args.incoming_call_webhook_url ?? null
  if (action === 'webhook') {
    if (!isUrl(webhookUrl, 'https:')) throw new Error('inkbox: incoming_call_webhook_url must be an https:// URL when incoming_call_action is webhook')
  } else if (action === 'auto_reject') {
    if (webhookUrl !== null) throw new Error('inkbox: incoming_call_webhook_url must be null when incoming_call_action is auto_reject')
  } else {
    throw new Error('inkbox: incoming_call_action must be webhook or auto_reject')
  }
  const op = spec.capabilities.find((candidate) => candidate.name === inv.capabilityName)!
  const response = await executeRestRequest(spec, {
    ...op.request,
    body: { incoming_call_action: '{incoming_call_action}', incoming_call_webhook_url: action === 'webhook' ? '{incoming_call_webhook_url}' : null },
  }, { ...inv, args: { incoming_call_action: action, incoming_call_webhook_url: webhookUrl } }, ['incoming_call_action'])
  return mutationResultFromTransport(spec.displayName, response)
}

function placeCallArgs(input: Record<string, unknown>): Record<string, unknown> {
  const args = allowOnly(input, ['from_number', 'to_number', 'client_websocket_url'])
  for (const field of ['from_number', 'to_number'] as const) {
    const value = args[field]
    if (typeof value !== 'string' || !E164.test(value)) throw new Error(`inkbox: ${field} must be an E.164 phone number`)
  }
  if (!isUrl(args.client_websocket_url, 'wss:')) throw new Error('inkbox: client_websocket_url must be a wss:// URL')
  return args
}

function allowOnly(input: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new Error(`inkbox: unsupported argument ${unknown.join(', ')}`)
  return input
}

function isUrl(value: unknown, protocol: 'https:' | 'wss:'): value is string {
  if (typeof value !== 'string' || value.length > urlMaxLength || !value.startsWith(`${protocol}//`)) return false
  try {
    const url = new URL(value)
    return url.protocol === protocol && url.hostname !== '' && !url.username && !url.password
  } catch {
    return false
  }
}
