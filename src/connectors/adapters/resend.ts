import { declarativeRestConnector } from './declarative-rest.js'

const email = { type: 'string', minLength: 3, maxLength: 320, format: 'email' }
const id = { type: 'string', minLength: 1, maxLength: 256 }
const headerKey = { type: 'string', minLength: 1, maxLength: 256, pattern: '^[^\\x00-\\x20\\x7f]+$' }
const messageId = { type: 'string', minLength: 3, maxLength: 256, pattern: '^<[^<>\\x00-\\x1f\\x7f]+>$' }
const recipients = { type: 'array', minItems: 1, maxItems: 50, items: email }
const message = { type: 'string', minLength: 1, maxLength: 1_000_000 }
const send = {
  from: email, to: recipients, subject: { type: 'string', minLength: 1, maxLength: 998, pattern: '^[^\\x00-\\x1f\\x7f]*$' },
  text: message, message_key: headerKey,
}

/** Resend stores received mail and deduplicates sends by Idempotency-Key for 24 hours. */
export const resendConnector = declarativeRestConnector({
  kind: 'resend', displayName: 'Resend', category: 'comms',
  description: 'Read owned incoming mail and send replies from a verified domain.',
  auth: { kind: 'api-key', hint: 'Resend API key with domain, receiving and sending access.' },
  baseUrl: 'https://api.resend.com', defaultConsistencyModel: 'advisory',
  test: { method: 'GET', path: '/domains' },
  capabilities: [
    { name: 'domains.list', class: 'read', description: 'List domains available to this API key.',
      parameters: { type: 'object', properties: {} }, request: { method: 'GET', path: '/domains' } },
    { name: 'emails.receiving.get', class: 'read', description: 'Read a received email after its signed notification.',
      parameters: { type: 'object', properties: { email_id: id }, required: ['email_id'] },
      request: { method: 'GET', path: '/emails/receiving/{email_id}' } },
    { name: 'emails.receiving.attachments.list', class: 'read', description: 'List attachments on a received email.',
      parameters: { type: 'object', properties: { email_id: id }, required: ['email_id'] },
      request: { method: 'GET', path: '/emails/receiving/{email_id}/attachments' } },
    { name: 'emails.send', class: 'mutation', cas: 'native-idempotency', externalEffect: true,
      description: 'Send plain-text mail from a verified domain with one stable idempotency key.',
      parameters: { type: 'object', properties: send, required: ['from', 'to', 'subject', 'text', 'message_key'] },
      request: { method: 'POST', path: '/emails', headers: { 'Idempotency-Key': '{message_key}' },
        body: { from: '{from}', to: '{to}', subject: '{subject}', text: '{text}' } } },
    { name: 'emails.reply', class: 'mutation', cas: 'native-idempotency', externalEffect: true,
      description: 'Reply to a received email from a verified domain with an exact parent Message-ID.',
      parameters: { type: 'object', properties: { ...send, in_reply_to: messageId },
        required: ['from', 'to', 'subject', 'text', 'message_key', 'in_reply_to'] },
      request: { method: 'POST', path: '/emails', headers: { 'Idempotency-Key': '{message_key}' },
        body: { from: '{from}', to: '{to}', subject: '{subject}', text: '{text}',
          headers: { 'In-Reply-To': '{in_reply_to}', References: '{in_reply_to}' } } } },
  ],
})
