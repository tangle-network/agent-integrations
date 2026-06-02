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
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a new contact list.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the list to create.' },
          folderId: {
            type: 'integer',
            description: 'ID of the parent folder to place the list under.',
          },
        },
        required: ['name', 'folderId'],
      },
      request: {
        method: 'POST',
        path: '/contacts/lists',
        body: { name: '{name}', folderId: '{folderId}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.delete',
      class: 'mutation',
      description: 'Delete a contact list by ID.',
      parameters: {
        type: 'object',
        properties: {
          listId: {
            type: 'integer',
            description: 'ID of the list to delete.',
          },
        },
        required: ['listId'],
      },
      request: {
        method: 'DELETE',
        path: '/contacts/lists/{listId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.addContacts',
      class: 'mutation',
      description: 'Add existing contacts (by email) to a list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'integer' },
          emails: {
            type: 'array',
            items: { type: 'string' },
            description: 'Email addresses of contacts to add.',
          },
        },
        required: ['listId', 'emails'],
      },
      request: {
        method: 'POST',
        path: '/contacts/lists/{listId}/contacts/add',
        body: { emails: '{emails}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'campaigns.send',
      class: 'mutation',
      description: 'Trigger sending of an email campaign immediately.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: {
            type: 'integer',
            description: 'ID of the campaign to send.',
          },
        },
        required: ['campaignId'],
      },
      request: {
        method: 'POST',
        path: '/emailCampaigns/{campaignId}/sendNow',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'transactional.send',
      class: 'mutation',
      description: 'Send a transactional email via the SMTP API.',
      parameters: {
        type: 'object',
        properties: {
          sender: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
            },
            required: ['email'],
          },
          to: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string' },
              },
              required: ['email'],
            },
          },
          subject: { type: 'string' },
          htmlContent: { type: 'string' },
          textContent: { type: 'string' },
          templateId: { type: 'integer' },
          params: { type: 'object' },
          replyTo: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
            },
          },
          cc: { type: 'array' },
          bcc: { type: 'array' },
          attachment: { type: 'array' },
          headers: { type: 'object' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['sender', 'to'],
      },
      request: {
        method: 'POST',
        path: '/smtp/email',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
