import { declarativeRestConnector } from './declarative-rest.js'

// EmailOctopus exposes a flat REST API at https://api.emailoctopus.com.
// Contacts are addressed by the MD5 of their lowercase email (or the
// EmailOctopus contact id when present). The connector forwards the
// caller-supplied {contactId} verbatim; agents that pass an email must
// hash it before invocation.
export const emailoctopusConnector = declarativeRestConnector({
  kind: 'emailoctopus',
  displayName: 'EmailOctopus',
  description:
    'Email marketing: manage EmailOctopus lists and contacts (add/update, tag, unsubscribe, find).',
  auth: {
    kind: 'api-key',
    hint: 'EmailOctopus API key from Account → Integrations & API. Sent as a Bearer token on every request.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.emailoctopus.com',
  test: { method: 'GET', path: '/lists' },
  capabilities: [
    {
      name: 'contacts.addOrUpdate',
      class: 'mutation',
      description: 'Add a contact to a list, or update it if the email is already present.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          email_address: { type: 'string' },
          fields: { type: 'object' },
          tags: { type: 'object' },
          status: {
            type: 'string',
            enum: ['subscribed', 'unsubscribed', 'pending'],
          },
        },
        required: ['listId', 'email_address'],
      },
      request: {
        method: 'PUT',
        path: '/lists/{listId}/contacts',
        body: {
          email_address: '{email_address}',
          fields: '{fields}',
          tags: '{tags}',
          status: '{status}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.unsubscribe',
      class: 'mutation',
      description: 'Unsubscribe a contact from a list by contact id (MD5 of lowercased email).',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          contactId: { type: 'string' },
        },
        required: ['listId', 'contactId'],
      },
      request: {
        method: 'PUT',
        path: '/lists/{listId}/contacts/{contactId}',
        body: { status: 'unsubscribed' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.updateEmail',
      class: 'mutation',
      description: 'Update a contact email by replacing the address on the existing contact.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          contactId: { type: 'string' },
          new_email_address: { type: 'string' },
        },
        required: ['listId', 'contactId', 'new_email_address'],
      },
      request: {
        method: 'PUT',
        path: '/lists/{listId}/contacts/{contactId}',
        body: { email_address: '{new_email_address}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.addTag',
      class: 'mutation',
      description: 'Add a tag to a contact. Existing tags are preserved.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          contactId: { type: 'string' },
          tag: { type: 'string' },
        },
        required: ['listId', 'contactId', 'tag'],
      },
      request: {
        method: 'PUT',
        path: '/lists/{listId}/contacts/{contactId}',
        body: {
          tags: { '{tag}': true },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.removeTag',
      class: 'mutation',
      description: 'Remove a tag from a contact. Other tags are preserved.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          contactId: { type: 'string' },
          tag: { type: 'string' },
        },
        required: ['listId', 'contactId', 'tag'],
      },
      request: {
        method: 'PUT',
        path: '/lists/{listId}/contacts/{contactId}',
        body: {
          tags: { '{tag}': false },
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a new list.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/lists',
        body: { name: '{name}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.find',
      class: 'read',
      description: 'Look up a single contact by id within a list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          contactId: { type: 'string' },
        },
        required: ['listId', 'contactId'],
      },
      request: { method: 'GET', path: '/lists/{listId}/contacts/{contactId}' },
    },
  ],
})
