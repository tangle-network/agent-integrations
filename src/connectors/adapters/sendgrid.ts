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
  ],
})
