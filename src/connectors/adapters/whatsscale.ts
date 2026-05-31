import { declarativeRestConnector } from './declarative-rest.js'

export const whatsscaleConnector = declarativeRestConnector({
  kind: 'whatsscale',
  displayName: 'WhatsScale',
  description: 'Send WhatsApp messages, manage contacts, and automate conversations via WAHA.',
  auth: { kind: 'api-key', hint: 'WhatsScale API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.whatsscale.com/v1',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a CRM contact.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
          name: { type: 'string' },
          tags: { type: 'string' },
        },
        required: ['phone'],
      },
      request: {
        method: 'POST',
        path: '/crm/contacts',
        body: { phone: '{phone}', name: '{name}', tags: '{tags}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Get a CRM contact by ID.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
        },
        required: ['contactId'],
      },
      request: { method: 'GET', path: '/crm/contacts/{contactId}' },
    },
    {
      name: 'contacts.findByPhone',
      class: 'read',
      description: 'Find a CRM contact by phone number.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
        },
        required: ['phone'],
      },
      request: { method: 'GET', path: '/crm/contacts/phone/{phone}' },
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update a CRM contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          name: { type: 'string' },
          tags: { type: 'string' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'PATCH',
        path: '/crm/contacts/{contactId}',
        body: { name: '{name}', tags: '{tags}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete a CRM contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
        },
        required: ['contactId'],
      },
      request: { method: 'DELETE', path: '/crm/contacts/{contactId}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.list',
      class: 'read',
      description: 'List CRM contacts.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          limit: { type: 'integer' },
          page: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/crm/contacts',
        query: { search: '{search}', limit: '{limit}', page: '{page}' },
      },
    },
    {
      name: 'contacts.addTag',
      class: 'mutation',
      description: 'Add a tag to a CRM contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          tag: { type: 'string' },
        },
        required: ['contactId', 'tag'],
      },
      request: {
        method: 'POST',
        path: '/crm/contacts/{contactId}/tags',
        body: { tag: '{tag}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.removeTag',
      class: 'mutation',
      description: 'Remove a tag from a CRM contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          tag: { type: 'string' },
        },
        required: ['contactId', 'tag'],
      },
      request: {
        method: 'DELETE',
        path: '/crm/contacts/{contactId}/tags/{tag}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'messages.sendText',
      class: 'mutation',
      description: 'Send a text message to a contact.',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string' },
          text: { type: 'string' },
          chatType: { type: 'string' },
        },
        required: ['recipient', 'text', 'chatType'],
      },
      request: {
        method: 'POST',
        path: '/messages/text',
        body: { recipient: '{recipient}', text: '{text}', chatType: '{chatType}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.sendImage',
      class: 'mutation',
      description: 'Send an image to a contact.',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string' },
          imageUrl: { type: 'string' },
          chatType: { type: 'string' },
        },
        required: ['recipient', 'imageUrl', 'chatType'],
      },
      request: {
        method: 'POST',
        path: '/messages/image',
        body: { recipient: '{recipient}', imageUrl: '{imageUrl}', chatType: '{chatType}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.sendVideo',
      class: 'mutation',
      description: 'Send a video to a contact.',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string' },
          videoUrl: { type: 'string' },
          chatType: { type: 'string' },
        },
        required: ['recipient', 'videoUrl', 'chatType'],
      },
      request: {
        method: 'POST',
        path: '/messages/video',
        body: { recipient: '{recipient}', videoUrl: '{videoUrl}', chatType: '{chatType}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.sendDocument',
      class: 'mutation',
      description: 'Send a document to a contact.',
      parameters: {
        type: 'object',
        properties: {
          recipient: { type: 'string' },
          documentUrl: { type: 'string' },
          filename: { type: 'string' },
          caption: { type: 'string' },
          chatType: { type: 'string' },
        },
        required: ['recipient', 'documentUrl', 'chatType'],
      },
      request: {
        method: 'POST',
        path: '/messages/document',
        body: {
          recipient: '{recipient}',
          documentUrl: '{documentUrl}',
          filename: '{filename}',
          caption: '{caption}',
          chatType: '{chatType}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'whatsapp.check',
      class: 'read',
      description: 'Check if a number is registered on WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string' },
        },
        required: ['phone'],
      },
      request: { method: 'GET', path: '/whatsapp/check/{phone}' },
    },
  ],
})
