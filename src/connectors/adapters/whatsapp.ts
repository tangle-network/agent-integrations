import { declarativeRestConnector } from './declarative-rest.js'

export const whatsappConnector = declarativeRestConnector({
  kind: 'whatsapp',
  displayName: 'WhatsApp Business',
  description: 'Send messages, media, and templates via WhatsApp Business API.',
  auth: {
    kind: 'api-key',
    hint: 'WhatsApp Business System User Access Token.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.instagram.com/v21.0',
  test: { method: 'GET', path: '/{businessAccountId}' },
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
          businessAccountId: { type: 'string', description: 'Business Account ID' },
        },
        required: ['to', 'text', 'businessAccountId'],
      },
      request: {
        method: 'POST',
        path: '/{businessAccountId}/messages',
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '{to}',
          type: 'text',
          text: { body: '{text}' },
        },
      },
      cas: 'native-idempotency',
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
          businessAccountId: { type: 'string', description: 'Business Account ID' },
        },
        required: ['to', 'type', 'media', 'businessAccountId'],
      },
      request: {
        method: 'POST',
        path: '/{businessAccountId}/messages',
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '{to}',
          type: '{type}',
          ['{type}']: { link: '{media}', caption: '{caption}', filename: '{filename}' },
        },
      },
      cas: 'native-idempotency',
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
          businessAccountId: { type: 'string', description: 'Business Account ID' },
        },
        required: ['to', 'templateName', 'language', 'businessAccountId'],
      },
      request: {
        method: 'POST',
        path: '/{businessAccountId}/messages',
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
      cas: 'native-idempotency',
    },
  ],
})
