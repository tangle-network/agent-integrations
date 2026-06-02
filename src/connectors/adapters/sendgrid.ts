import { declarativeRestConnector } from './declarative-rest.js'

const emailAddress = {
  type: 'object',
  properties: {
    email: { type: 'string' },
    name: { type: 'string' },
  },
  required: ['email'],
}

export const sendgridConnector = declarativeRestConnector({
  kind: 'sendgrid',
  displayName: 'SendGrid',
  description: 'Send transactional email and manage marketing contacts/lists through the SendGrid v3 API.',
  auth: {
    kind: 'api-key',
    hint: 'SendGrid API key with at least Mail Send + Marketing scopes (Settings → API Keys).',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.sendgrid.com',
  test: { method: 'GET', path: '/v3/scopes' },
  capabilities: [
    {
      name: 'mail.send',
      class: 'mutation',
      description: 'Send a transactional email via /v3/mail/send.',
      parameters: {
        type: 'object',
        properties: {
          personalizations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                to: { type: 'array', items: emailAddress },
                cc: { type: 'array', items: emailAddress },
                bcc: { type: 'array', items: emailAddress },
                subject: { type: 'string' },
                dynamic_template_data: { type: 'object' },
              },
              required: ['to'],
            },
          },
          from: emailAddress,
          reply_to: emailAddress,
          subject: { type: 'string' },
          content: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['type', 'value'],
            },
          },
          template_id: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
          send_at: { type: 'integer' },
        },
        required: ['personalizations', 'from'],
      },
      request: { method: 'POST', path: '/v3/mail/send', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.search',
      class: 'read',
      description: 'Search marketing contacts using SGQL.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      request: { method: 'POST', path: '/v3/marketing/contacts/search', body: { query: '{query}' } },
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Read a single marketing contact by ID.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' } },
        required: ['contactId'],
      },
      request: { method: 'GET', path: '/v3/marketing/contacts/{contactId}' },
    },
    {
      name: 'contacts.upsert',
      class: 'mutation',
      description: 'Add or update marketing contacts (upsert by email).',
      parameters: {
        type: 'object',
        properties: {
          list_ids: { type: 'array', items: { type: 'string' } },
          contacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                custom_fields: { type: 'object' },
              },
              required: ['email'],
            },
          },
        },
        required: ['contacts'],
      },
      request: { method: 'PUT', path: '/v3/marketing/contacts', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'lists.search',
      class: 'read',
      description: 'List marketing lists.',
      parameters: {
        type: 'object',
        properties: {
          page_size: { type: 'integer', minimum: 1, maximum: 1000 },
          page_token: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v3/marketing/lists',
        query: { page_size: '{page_size}', page_token: '{page_token}' },
      },
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a marketing list.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      request: { method: 'POST', path: '/v3/marketing/lists', body: { name: '{name}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete one or more marketing contacts by ID.',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'string',
            description: 'Comma-separated list of contact IDs to delete.',
          },
          delete_all_contacts: {
            type: 'string',
            description: 'Set to "true" to delete every contact on the account.',
          },
        },
      },
      request: {
        method: 'DELETE',
        path: '/v3/marketing/contacts',
        query: { ids: '{ids}', delete_all_contacts: '{delete_all_contacts}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.delete',
      class: 'mutation',
      description: 'Delete a marketing list. Optionally delete the contacts on it.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          delete_contacts: { type: 'boolean' },
        },
        required: ['listId'],
      },
      request: {
        method: 'DELETE',
        path: '/v3/marketing/lists/{listId}',
        query: { delete_contacts: '{delete_contacts}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.addContacts',
      class: 'mutation',
      description: 'Add contacts to a marketing list by upserting them with the given list_ids.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          contacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                custom_fields: { type: 'object' },
              },
              required: ['email'],
            },
          },
        },
        required: ['listId', 'contacts'],
      },
      request: {
        method: 'PUT',
        path: '/v3/marketing/contacts',
        body: {
          list_ids: ['{listId}'],
          contacts: '{contacts}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.removeContacts',
      class: 'mutation',
      description: 'Remove contacts from a marketing list (does not delete the contacts).',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          contact_ids: {
            type: 'string',
            description: 'Comma-separated list of contact IDs to remove from the list.',
          },
        },
        required: ['listId', 'contact_ids'],
      },
      request: {
        method: 'DELETE',
        path: '/v3/marketing/lists/{listId}/contacts',
        query: { contact_ids: '{contact_ids}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'suppressions.create',
      class: 'mutation',
      description: 'Add one or more email addresses to a suppression group.',
      parameters: {
        type: 'object',
        properties: {
          groupId: { type: 'string' },
          recipient_emails: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['groupId', 'recipient_emails'],
      },
      request: {
        method: 'POST',
        path: '/v3/asm/groups/{groupId}/suppressions',
        body: { recipient_emails: '{recipient_emails}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
