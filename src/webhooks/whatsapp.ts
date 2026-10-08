import { verifyHmacSignature, firstHeader } from '../connectors/webhooks.js'
import type { WebhookProvider, WebhookEnvelope } from './router.js'

export type MetaWhatsappProvider = 'whatsapp' | 'whatsapp-business'
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const graphId = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{1,64}$/.test(v)

/** Bind one callback to one WABA and number. The app secret authenticates Meta,
 * not the tenant: app-wide signatures alone cannot establish account ownership. */
export function createWhatsappWebhookProvider(options: {
  providerId: MetaWhatsappProvider
  wabaId: string
  phoneNumberId: string
}): WebhookProvider {
  if (!graphId(options.wabaId) || !graphId(options.phoneNumberId)) throw new Error('Meta webhook requires a WABA and phone number ID')
  return {
    id: options.providerId,
    verifySignature({ rawBody, headers, secret }) {
      const signature = firstHeader(headers, 'x-hub-signature-256')
      return signature && /^sha256=[a-f0-9]{64}$/.test(signature)
        && verifyHmacSignature(rawBody, signature, secret, { algorithm: 'sha256', signaturePrefix: 'sha256=' })
        ? { valid: true } : { valid: false, reason: 'invalid_signature' }
    },
    parse({ rawBody, headers, now }) {
      const body: unknown = JSON.parse(rawBody)
      if (!record(body) || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry) || body.entry.length > 100) throw new Error('Invalid WhatsApp webhook envelope')
      const events: WebhookEnvelope[] = []
      for (const entry of body.entry) {
        if (!record(entry) || !Array.isArray(entry.changes) || entry.changes.length > 100) throw new Error('Invalid WhatsApp entry')
        if (entry.id !== options.wabaId) continue
        for (const change of entry.changes) {
          if (!record(change) || change.field !== 'messages' || !record(change.value)) continue
          const value = change.value
          if (value.messaging_product !== 'whatsapp' || !record(value.metadata)
            || value.metadata.phone_number_id !== options.phoneNumberId) continue
          if (value.messages === undefined) continue // Delivery status is not an incoming command.
          if (!Array.isArray(value.messages) || value.messages.length > 100) throw new Error('Invalid WhatsApp messages')
          for (const message of value.messages) {
            if (!record(message) || typeof message.id !== 'string' || !message.id || message.id.length > 256) throw new Error('Invalid WhatsApp message identity')
            events.push({ provider: options.providerId, eventType: `${options.providerId}.message.received`,
              providerEventId: `${options.phoneNumberId}:${message.id}`, receivedAt: now ?? Date.now(),
              payload: { wabaId: options.wabaId, phoneNumberId: options.phoneNumberId, message },
              headers: Object.fromEntries(Object.entries(headers).flatMap(([k,v]) => typeof v === 'string' ? [[k.toLowerCase(), v]] : [])),
            })
          }
        }
      }
      return events
    },
    eventCatalog: { namespace: `${options.providerId}.`, closed: true, events: [{ id: `${options.providerId}.message.received` }] },
  }
}
