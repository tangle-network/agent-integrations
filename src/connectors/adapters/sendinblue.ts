import { declarativeRestConnector } from './declarative-rest.js'

export const sendinblueConnector = declarativeRestConnector({
  kind: 'sendinblue',
  displayName: 'Sendinblue',
  description: 'Create or update contacts in Sendinblue with attributes, list assignments, and blacklist management.',
  auth: {
    kind: 'api-key',
    hint: 'Sendinblue API key (from Account → SMTP & API → API keys).',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.sendinblue.com/v3',
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'contacts.createOrUpdate',
      class: 'mutation',
      description: 'Create a new contact or update an existing contact.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'Email address of the contact. Required for creating or updating a contact.',
          },
          extId: {
            type: 'string',
            description: 'External ID to associate with the contact.',
          },
          attributes: {
            type: 'object',
            description: 'Contact attributes as key-value pairs (e.g., firstName, lastName, phone, custom fields).',
          },
          emailBlacklisted: {
            type: 'boolean',
            description: 'Set to true to blacklist the contact for email communications.',
          },
          smsBlacklisted: {
            type: 'boolean',
            description: 'Set to true to blacklist the contact for SMS communications.',
          },
          listIds: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Array of list IDs to add the contact to.',
          },
          smtpBlacklistSender: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of sender email addresses to blacklist for SMTP (transactional email).',
          },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/contacts/upsert',
        body: {
          email: '{email}',
          extId: '{extId}',
          attributes: '{attributes}',
          emailBlacklisted: '{emailBlacklisted}',
          smsBlacklisted: '{smsBlacklisted}',
          listIds: '{listIds}',
          smtpBlacklistSender: '{smtpBlacklistSender}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Get a single contact by email address.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'Email address of the contact to retrieve.',
          },
        },
        required: ['email'],
      },
      request: {
        method: 'GET',
        path: '/contacts/{email}',
      },
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete a contact by email address.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'Email address of the contact to delete.',
          },
        },
        required: ['email'],
      },
      request: {
        method: 'DELETE',
        path: '/contacts/{email}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.get',
      class: 'read',
      description: 'Get all lists in the Sendinblue account.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: 'Number of lists to retrieve.',
          },
          offset: {
            type: 'integer',
            description: 'Offset for pagination.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/lists',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
  ],
})
