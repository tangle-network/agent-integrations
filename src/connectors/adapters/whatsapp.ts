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
          businessAccountId: { type: 'string', description: 'Business Account ID' },
        },
        required: ['to', 'text', 'replyToMessageId', 'businessAccountId'],
      },
      request: {
        method: 'POST',
        path: '/{businessAccountId}/messages',
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '{to}',
          context: { message_id: '{replyToMessageId}' },
          type: 'text',
          text: { body: '{text}' },
        },
      },
      cas: 'native-idempotency',
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
          businessAccountId: { type: 'string', description: 'Business Account ID' },
        },
        required: ['to', 'messageId', 'emoji', 'businessAccountId'],
      },
      request: {
        method: 'POST',
        path: '/{businessAccountId}/messages',
        body: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '{to}',
          type: 'reaction',
          reaction: { message_id: '{messageId}', emoji: '{emoji}' },
        },
      },
      cas: 'native-idempotency',
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
      cas: 'native-idempotency',
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
