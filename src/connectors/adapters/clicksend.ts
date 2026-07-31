import { declarativeRestConnector } from './declarative-rest.js'

const pagination = {
  page: { type: 'integer', minimum: 1 },
  limit: { type: 'integer', minimum: 1 },
}

const paginationQuery = { page: '{page}', limit: '{limit}' }

const listId = { listId: { type: 'integer' } }
const contactId = { contactId: { type: 'integer' } }

export const clicksendConnector = declarativeRestConnector({
  kind: 'clicksend',
  displayName: 'ClickSend',
  description: 'Send and track SMS or voice messages, and manage ClickSend contact lists.',
  auth: {
    kind: 'api-key',
    hint: 'JSON containing username and apiKey from the ClickSend dashboard.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://rest.clicksend.com/v3',
  credentialPlacement: {
    kind: 'basic-structured',
    usernameField: 'username',
    passwordField: 'apiKey',
  },
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'account.get',
      class: 'read',
      description: 'Read account details and balance.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/account' },
    },
    {
      name: 'lists.list',
      class: 'read',
      description: 'List contact lists.',
      parameters: { type: 'object', properties: pagination },
      request: { method: 'GET', path: '/lists', query: paginationQuery },
    },
    {
      name: 'lists.get',
      class: 'read',
      description: 'Read one contact list.',
      parameters: { type: 'object', properties: listId, required: ['listId'] },
      request: { method: 'GET', path: '/lists/{listId}' },
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a contact list.',
      parameters: {
        type: 'object',
        properties: { listName: { type: 'string' } },
        required: ['listName'],
      },
      request: { method: 'POST', path: '/lists', body: { list_name: '{listName}' } },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'lists.update',
      class: 'mutation',
      description: 'Rename a contact list.',
      parameters: {
        type: 'object',
        properties: { ...listId, listName: { type: 'string' } },
        required: ['listId', 'listName'],
      },
      request: { method: 'PUT', path: '/lists/{listId}', body: { list_name: '{listName}' } },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'lists.delete',
      class: 'mutation',
      description: 'Delete a contact list.',
      parameters: { type: 'object', properties: listId, required: ['listId'] },
      request: { method: 'DELETE', path: '/lists/{listId}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'contacts.list',
      class: 'read',
      description: 'List contacts in a list.',
      parameters: {
        type: 'object',
        properties: { ...listId, ...pagination, updatedAfter: { type: 'integer' } },
        required: ['listId'],
      },
      request: {
        method: 'GET',
        path: '/lists/{listId}/contacts',
        query: { ...paginationQuery, updated_after: '{updatedAfter}' },
      },
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Read one contact.',
      parameters: {
        type: 'object',
        properties: { ...listId, ...contactId },
        required: ['listId', 'contactId'],
      },
      request: { method: 'GET', path: '/lists/{listId}/contacts/{contactId}' },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Add a contact to a list.',
      parameters: {
        type: 'object',
        properties: {
          ...listId,
          contact: { type: 'object', description: 'ClickSend Contact model including phone_number.' },
        },
        required: ['listId', 'contact'],
      },
      request: { method: 'POST', path: '/lists/{listId}/contacts', body: '{contact}' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update a contact.',
      parameters: {
        type: 'object',
        properties: {
          ...listId,
          ...contactId,
          contact: { type: 'object', description: 'ClickSend Contact model.' },
        },
        required: ['listId', 'contactId', 'contact'],
      },
      request: { method: 'PUT', path: '/lists/{listId}/contacts/{contactId}', body: '{contact}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete a contact from a list.',
      parameters: {
        type: 'object',
        properties: { ...listId, ...contactId },
        required: ['listId', 'contactId'],
      },
      request: { method: 'DELETE', path: '/lists/{listId}/contacts/{contactId}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'sms.history',
      class: 'read',
      description: 'List sent SMS history.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          dateFrom: { type: 'integer' },
          dateTo: { type: 'integer' },
          ...pagination,
        },
      },
      request: {
        method: 'GET',
        path: '/sms/history',
        query: {
          q: '{query}',
          date_from: '{dateFrom}',
          date_to: '{dateTo}',
          ...paginationQuery,
        },
      },
    },
    {
      name: 'sms.inbound.list',
      class: 'read',
      description: 'List inbound SMS messages.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, ...pagination },
      },
      request: { method: 'GET', path: '/sms/inbound', query: { q: '{query}', ...paginationQuery } },
    },
    {
      name: 'sms.receipts.list',
      class: 'read',
      description: 'List SMS delivery receipts.',
      parameters: { type: 'object', properties: pagination },
      request: { method: 'GET', path: '/sms/receipts', query: paginationQuery },
    },
    {
      name: 'sms.send',
      class: 'mutation',
      description: 'Send up to 1,000 SMS messages in one request.',
      parameters: {
        type: 'object',
        properties: {
          messages: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'object' } },
        },
        required: ['messages'],
      },
      request: { method: 'POST', path: '/sms/send', body: { messages: '{messages}' } },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'sms.cancel',
      class: 'mutation',
      description: 'Cancel a scheduled SMS message.',
      parameters: {
        type: 'object',
        properties: { messageId: { type: 'string' } },
        required: ['messageId'],
      },
      request: { method: 'PUT', path: '/sms/{messageId}/cancel' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'voice.history',
      class: 'read',
      description: 'List voice message history.',
      parameters: {
        type: 'object',
        properties: { dateFrom: { type: 'integer' }, dateTo: { type: 'integer' }, ...pagination },
      },
      request: {
        method: 'GET',
        path: '/voice/history',
        query: { date_from: '{dateFrom}', date_to: '{dateTo}', ...paginationQuery },
      },
    },
    {
      name: 'voice.send',
      class: 'mutation',
      description: 'Send voice messages.',
      parameters: {
        type: 'object',
        properties: { messages: { type: 'array', minItems: 1, items: { type: 'object' } } },
        required: ['messages'],
      },
      request: { method: 'POST', path: '/voice/send', body: { messages: '{messages}' } },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'voice.cancel',
      class: 'mutation',
      description: 'Cancel a scheduled voice message.',
      parameters: {
        type: 'object',
        properties: { messageId: { type: 'string' } },
        required: ['messageId'],
      },
      request: { method: 'PUT', path: '/voice/{messageId}/cancel' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
  ],
})
