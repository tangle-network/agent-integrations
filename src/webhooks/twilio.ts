import { authenticateTwilioForm } from '../twilio/index.js'
import type { WebhookProvider } from './router.js'

/** Bind to a trusted exact external route; forwarded Host headers are not a signing authority. */
export function createTwilioWebhookProvider(options: {
  url: string
  accountSid: string
  kind: 'message' | 'status'
}): WebhookProvider {
  if (!['message', 'status'].includes(options.kind)) throw new Error('Choose message or status webhook mode')
  const bound = { ...options }
  return {
    id: 'twilio',
    verifySignature({ rawBody, headers, secret }) {
      const key = Object.keys(headers).find(k => k.toLowerCase() === 'x-twilio-signature')
      const signature = key ? headers[key] : undefined
      try {
        authenticateTwilioForm({ url: bound.url, rawBody, signature, authToken: secret, accountSid: bound.accountSid })
        return { valid: true }
      } catch { return { valid: false, reason: 'invalid_twilio_form_or_signature' } }
    },
    parse({ rawBody, now }) {
      const data = Object.fromEntries(new URLSearchParams(rawBody))
      if (!/^SM[a-f0-9]{32}$/i.test(data.MessageSid ?? '')) throw new Error('Twilio event has no valid message identity')
      const status = bound.kind === 'status' ? data.MessageStatus : 'received'
      if (!status || !/^[a-z_]+$/.test(status)) throw new Error('Twilio status event has no status')
      return [{ provider: 'twilio', eventType: `twilio.message.${bound.kind === 'status' ? 'status' : 'received'}`,
        // A message SID alone would incorrectly deduplicate all subsequent delivery states.
        providerEventId: `${bound.accountSid}:${data.MessageSid}:${bound.kind}:${status}`,
        receivedAt: now ?? Date.now(), payload: data, headers: {} }]
    },
    successResponse: { body: '<Response/>', headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
    eventCatalog: { namespace: 'twilio.', closed: true,
      events: [{ id: 'twilio.message.received' }, { id: 'twilio.message.status' }] },
  }
}
