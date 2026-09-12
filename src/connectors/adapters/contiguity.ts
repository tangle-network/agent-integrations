import { declarativeRestConnector } from './declarative-rest.js'

const address = { type: 'string', minLength: 1, maxLength: 320 }
const message = { type: 'string', minLength: 1, maxLength: 18000 }
const base = declarativeRestConnector({
  kind: 'contiguity', displayName: 'Contiguity', category: 'crm',
  description: 'Send email, text and iMessage through Contiguity. Acceptance is not delivery; unresolved sends require reconciliation.',
  auth: { kind: 'api-key', hint: 'Contiguity API key from console.contiguity.com/dashboard/tokens' },
  baseUrl: 'https://api.contiguity.com', defaultConsistencyModel: 'advisory',
  test: { method: 'GET', path: '/numbers/leased' },
  capabilities: [
    ...['messages.send_text', 'sms.send'].map((name) => ({
      name, class: 'mutation' as const, cas: 'none' as const, externalEffect: true,
      description: 'Send SMS from an explicitly selected owned number. Do not retry ambiguous outcomes blindly.',
      parameters: { type: 'object', properties: { to: address, from: address, message }, required: ['to', 'from', 'message'] },
      request: { method: 'POST' as const, path: '/send/text', body: { to: '{to}', from: '{from}', message: '{message}' } },
    })),
    { name: 'messages.send_imessage', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Send iMessage from an owned number; fallback is opt-in and must name its sender.',
      parameters: { type: 'object', properties: { to: address, from: address, message,
        attachments: { type: 'array', maxItems: 10, items: { type: 'string', pattern: '^https://' } },
        fallback: { type: 'object', properties: { from: address, when: { type: 'array', items: { type: 'string', enum: ['imessage_unsupported', 'imessage_fails'] } } }, required: ['from', 'when'], additionalProperties: false } },
        required: ['to', 'from', 'message'] },
      request: { method: 'POST', path: '/send/imessage', body: { to: '{to}', from: '{from}', message: '{message}', fallback: '{fallback}', attachments: '{attachments}' } } },
    { name: 'email.send', class: 'mutation', cas: 'none', externalEffect: true,
      description: 'Send an email from a verified sender. Legacy body/contentType inputs are translated to the documented text/html fields.',
      parameters: { type: 'object', properties: { to: address, from: address, subject: { type: 'string', maxLength: 998 },
        body: message, contentType: { type: 'string', enum: ['text/plain', 'text/html'] }, replyTo: address }, required: ['to', 'from', 'subject', 'body'] },
      request: { method: 'POST', path: '/send/email', body: { to: '{to}', from: '{from}', subject: '{subject}', text: '{text}', html: '{html}', reply_to: '{replyTo}' } } },
    { name: 'numbers.list', class: 'read', description: 'List numbers already leased by this account; does not purchase a number.',
      parameters: { type: 'object', properties: {} }, request: { method: 'GET', path: '/numbers/leased' } },
  ],
})

export const contiguityConnector: typeof base = {
  ...base,
  async executeMutation(inv) {
    if (inv.capabilityName !== 'email.send') return base.executeMutation!(inv)
    const { body, contentType, ...args } = inv.args
    if (typeof body !== 'string' || !body.length || (contentType !== undefined && contentType !== 'text/plain' && contentType !== 'text/html')) {
      throw new Error('Contiguity email requires a body and supported contentType')
    }
    // Callers cannot smuggle an unreviewed alternative body alongside the approved body.
    delete args.text
    delete args.html
    return base.executeMutation!({ ...inv, args: { ...args, body, contentType, [contentType === 'text/html' ? 'html' : 'text']: body } })
  },
}
