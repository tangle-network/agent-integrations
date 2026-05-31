import { declarativeRestConnector } from './declarative-rest.js'

export const vboutConnector = declarativeRestConnector({
  kind: 'vbout',
  displayName: 'VBOUT',
  description: 'Manage contacts, tags, and email campaigns in VBOUT marketing automation platform for agencies.',
  auth: {
    kind: 'api-key',
    hint: 'VBOUT API key from Settings. The connection must also store the per-account email for authentication.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.vbout.com/1',
  test: { method: 'GET', path: '/contacts' },
  capabilities: [
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Get a contact by email address.',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
      request: { method: 'GET', path: '/contacts/get', query: { email: '{email}' } },
    },
    {
      name: 'contacts.list',
      class: 'read',
      description: 'List all contacts or search with filters.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: { page: '{page}', limit: '{limit}' },
      },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Add a new contact to VBOUT.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          ipaddress: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/contacts/add',
        body: {
          email: '{email}',
          ipaddress: '{ipaddress}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          phone: '{phone}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update an existing contact.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/contacts/update',
        body: {
          email: '{email}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          phone: '{phone}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tags.add',
      class: 'mutation',
      description: 'Add a tag to a contact.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          tagname: { type: 'string' },
        },
        required: ['email', 'tagname'],
      },
      request: {
        method: 'POST',
        path: '/contacts/tags/add',
        body: { email: '{email}', tagname: '{tagname}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tags.remove',
      class: 'mutation',
      description: 'Remove a tag from a contact.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          tagname: { type: 'string' },
        },
        required: ['email', 'tagname'],
      },
      request: {
        method: 'POST',
        path: '/contacts/tags/remove',
        body: { email: '{email}', tagname: '{tagname}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'lists.get',
      class: 'read',
      description: 'Get list of email lists.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/lists',
        query: { page: '{page}', limit: '{limit}' },
      },
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a new email list.',
      parameters: {
        type: 'object',
        properties: { listname: { type: 'string' } },
        required: ['listname'],
      },
      request: { method: 'POST', path: '/lists/create', body: { listname: '{listname}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'campaigns.create',
      class: 'mutation',
      description: 'Create an email marketing campaign.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          subject: { type: 'string' },
          fromName: { type: 'string' },
          fromEmail: { type: 'string' },
          replyTo: { type: 'string' },
          lists: {
            type: 'array',
            items: { type: 'string' },
          },
          body: { type: 'string' },
          type: { type: 'string', enum: ['standard', 'autoresponder'] },
        },
        required: ['name', 'subject', 'fromName', 'fromEmail', 'replyTo', 'lists', 'body', 'type'],
      },
      request: {
        method: 'POST',
        path: '/campaigns/create',
        body: {
          name: '{name}',
          subject: '{subject}',
          from_name: '{fromName}',
          from_email: '{fromEmail}',
          reply_to: '{replyTo}',
          lists: '{lists}',
          body: '{body}',
          type: '{type}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.unsubscribe',
      class: 'mutation',
      description: 'Unsubscribe a contact from all lists.',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/contacts/unsubscribe',
        body: { email: '{email}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'social.messages.create',
      class: 'mutation',
      description: 'Create a social media message.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          platforms: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['message', 'platforms'],
      },
      request: {
        method: 'POST',
        path: '/social/messages/create',
        body: { message: '{message}', platforms: '{platforms}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
