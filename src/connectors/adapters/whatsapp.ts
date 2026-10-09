import { readWhatsappNumbers, whatsappNumbersCapability, whatsappWebhookStatusCapability } from './whatsapp-cloud.js'
import { declarativeRestConnector } from './declarative-rest.js'

const base = declarativeRestConnector({
  kind: 'whatsapp',
  displayName: 'WhatsApp Business',
  description: 'Send messages, media, and templates via WhatsApp Business API.',
  auth: {
    kind: 'api-key',
    hint: 'WhatsApp Business System User Access Token.',
  },
  category: 'comms',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://graph.facebook.com/v21.0',
  // Validate the token identity without requiring a model-supplied sending ID.
  test: { method: 'GET', path: '/me', query: { fields: 'id' } },
  capabilities: [
    {
      name: 'messages.send',
      class: 'mutation',
      description: 'Send a text message via WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number' },
          text: { type: 'string', description: 'Message text' },
          phoneNumberId: { type: 'string', pattern: '^[0-9]+$', maxLength: 64, description: 'Meta phone number ID for the sender, not a WhatsApp Business Account (WABA) ID.' },
        },
        required: ['to', 'text', 'phoneNumberId'],
      },
      request: {
        method: 'POST',
        path: '/{phoneNumberId}/messages',
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '{to}',
          type: 'text',
          text: { body: '{text}' },
        },
      },
      cas: 'none',
    },
    {
      name: 'media.send',
      class: 'mutation',
      description: 'Send media (image, audio, video, document) via WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number' },
          type: {
            type: 'string',
            enum: ['image', 'audio', 'video', 'document'],
            description: 'Media type',
          },
          media: { type: 'string', description: 'Media URL' },
          caption: { type: 'string', description: 'Caption for the media' },
          filename: { type: 'string', description: 'Filename (for documents)' },
          phoneNumberId: { type: 'string', pattern: '^[0-9]+$', maxLength: 64, description: 'Meta phone number ID for the sender, not a WhatsApp Business Account (WABA) ID.' },
        },
        required: ['to', 'type', 'media', 'phoneNumberId'],
      },
      request: {
        method: 'POST',
        path: '/{phoneNumberId}/messages',
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '{to}',
          type: '{type}',
          ['{type}']: { link: '{media}', caption: '{caption}', filename: '{filename}' },
        },
      },
      cas: 'none',
    },
    {
      name: 'template.send',
      class: 'mutation',
      description: 'Send a pre-approved template message via WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number' },
          templateName: { type: 'string', description: 'Name of the template' },
          language: { type: 'string', description: 'Template language code (e.g., en, es)' },
          parameters: { type: 'array', description: 'Template parameter values' },
          phoneNumberId: { type: 'string', pattern: '^[0-9]+$', maxLength: 64, description: 'Meta phone number ID for the sender, not a WhatsApp Business Account (WABA) ID.' },
        },
        required: ['to', 'templateName', 'language', 'phoneNumberId'],
      },
      request: {
        method: 'POST',
        path: '/{phoneNumberId}/messages',
        body: {
          messaging_product: 'whatsapp',
          to: '{to}',
          type: 'template',
          template: {
            name: '{templateName}',
            language: { code: '{language}' },
            components: { body: { parameters: '{parameters}' } },
          },
        },
      },
      cas: 'none',
    },
    {
      name: 'messages.reply',
      class: 'mutation',
      description: 'Reply to a specific WhatsApp message in-thread by quoting the original message id.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number' },
          text: { type: 'string', description: 'Reply text body' },
          replyToMessageId: { type: 'string', description: 'WAMID of the message to reply to' },
          phoneNumberId: { type: 'string', pattern: '^[0-9]+$', maxLength: 64, description: 'Meta phone number ID for the sender, not a WhatsApp Business Account (WABA) ID.' },
        },
        required: ['to', 'text', 'replyToMessageId', 'phoneNumberId'],
      },
      request: {
        method: 'POST',
        path: '/{phoneNumberId}/messages',
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '{to}',
          context: { message_id: '{replyToMessageId}' },
          type: 'text',
          text: { body: '{text}' },
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'messages.react',
      class: 'mutation',
      description: 'React to a specific WhatsApp message with an emoji. Pass an empty emoji to remove an existing reaction.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number' },
          messageId: { type: 'string', description: 'WAMID of the message to react to' },
          emoji: { type: 'string', description: 'Emoji to react with (empty string removes existing reaction)' },
          phoneNumberId: { type: 'string', pattern: '^[0-9]+$', maxLength: 64, description: 'Meta phone number ID for the sender, not a WhatsApp Business Account (WABA) ID.' },
        },
        required: ['to', 'messageId', 'emoji', 'phoneNumberId'],
      },
      request: {
        method: 'POST',
        path: '/{phoneNumberId}/messages',
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '{to}',
          type: 'reaction',
          reaction: { message_id: '{messageId}', emoji: '{emoji}' },
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'messages.delete',
      class: 'mutation',
      description: 'Delete a previously sent WhatsApp message by id.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'WAMID of the message to delete' },
          businessAccountId: { type: 'string', description: 'Business Account ID' },
        },
        required: ['messageId', 'businessAccountId'],
      },
      request: {
        method: 'DELETE',
        path: '/{businessAccountId}/messages/{messageId}',
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'contacts.list',
      class: 'read',
      description: 'List contacts associated with the WhatsApp Business Account.',
      parameters: {
        type: 'object',
        properties: {
          businessAccountId: { type: 'string', description: 'Business Account ID' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum number of contacts to return' },
        },
        required: ['businessAccountId'],
      },
      request: {
        method: 'GET',
        path: '/{businessAccountId}/contacts',
        query: { limit: '{limit}' },
      },
    },
  ],
})

// Cloud API /messages accepts a phone number ID. A WABA ID identifies the
// account and cannot be relabeled as a sending ID during migration.
const sendCapabilities = new Set(['messages.send', 'media.send', 'template.send', 'messages.reply', 'messages.react'])
export const whatsappConnector: typeof base = {
  ...base,
  manifest: { ...base.manifest, capabilities: [...base.manifest.capabilities, whatsappNumbersCapability, whatsappWebhookStatusCapability] },
  async executeRead(inv) {
    if ((inv.capabilityName === 'numbers.list' || inv.capabilityName === 'webhooks.status')) return readWhatsappNumbers(inv)
    return base.executeRead!(inv)
  },
  async executeMutation(inv) {
    if (sendCapabilities.has(inv.capabilityName)) {
      const { phoneNumberId, businessAccountId } = inv.args
      if (businessAccountId !== undefined || typeof phoneNumberId !== 'string'
        || !/^[0-9]{1,64}$/.test(phoneNumberId)) {
        throw new Error('WhatsApp sends require phoneNumberId, the Meta sender phone number ID; businessAccountId (WABA ID) is not a sending ID')
      }
    }
    return base.executeMutation!(inv)
  },
}
