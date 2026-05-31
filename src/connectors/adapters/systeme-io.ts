import { declarativeRestConnector } from './declarative-rest.js'

export const systemeIoConnector = declarativeRestConnector({
  kind: 'systeme-io',
  displayName: 'Systeme.io',
  description: 'Create and manage contacts, tags, and sales in Systeme.io CRM platform.',
  auth: { kind: 'api-key', hint: 'Systeme.io API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.systeme.io/v1',
  test: { method: 'GET', path: '/contacts' },
  capabilities: [
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a new contact in Systeme.io.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Contact email address' },
          name: { type: 'string', description: 'Contact name' },
          locale: { type: 'string', description: 'Contact preferred language' },
          fields: { type: 'object', description: 'Custom contact fields' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          email: '{email}',
          name: '{name}',
          locale: '{locale}',
          customFields: '{fields}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update an existing contact in Systeme.io.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID' },
          email: { type: 'string', description: 'Contact email address' },
          name: { type: 'string', description: 'Contact name' },
          fields: { type: 'object', description: 'Custom contact fields' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'PUT',
        path: '/contacts/{contactId}',
        body: {
          email: '{email}',
          name: '{name}',
          customFields: '{fields}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.findByEmail',
      class: 'read',
      description: 'Find a contact by email address.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Contact email to search' },
        },
        required: ['email'],
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: { email: '{email}' },
      },
    },
    {
      name: 'tags.addToContact',
      class: 'mutation',
      description: 'Add a tag to a contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID' },
          tagId: { type: 'string', description: 'Tag ID' },
        },
        required: ['contactId', 'tagId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/{contactId}/tags',
        body: {
          tagId: '{tagId}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tags.removeFromContact',
      class: 'mutation',
      description: 'Remove a tag from a contact.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string', description: 'Contact ID' },
          tagId: { type: 'string', description: 'Tag ID' },
        },
        required: ['contactId', 'tagId'],
      },
      request: {
        method: 'DELETE',
        path: '/contacts/{contactId}/tags/{tagId}',
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
