import { declarativeRestConnector } from './declarative-rest.js'

export const smooveConnector = declarativeRestConnector({
  kind: 'smoove',
  displayName: 'Smoove',
  description: 'Manage email lists and subscribers in Smoove.',
  auth: { kind: 'api-key', hint: 'Smoove API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.smoove.io/v1',
  test: { method: 'GET', path: '/lists' },
  capabilities: [
    {
      name: 'lists.get',
      class: 'read',
      description: 'Retrieve all email lists.',
      parameters: {
        type: 'object',
        properties: {
          skip: { type: 'integer', description: 'Number of records to skip' },
          take: { type: 'integer', description: 'Maximum number of records to return' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/lists', query: { skip: '{skip}', take: '{take}' } },
    },
    {
      name: 'subscribers.add',
      class: 'mutation',
      description: 'Add or update a subscriber in a list.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address of the subscriber' },
          firstName: { type: 'string', description: 'First name of the subscriber' },
          lastName: { type: 'string', description: 'Last name of the subscriber' },
          phone: { type: 'string', description: 'Phone number of the subscriber' },
          company: { type: 'string', description: 'Company name' },
          customFields: { type: 'object', description: 'Custom fields data' },
        },
        required: ['email'],
      },
      request: { method: 'POST', path: '/subscribers', body: { email: '{email}', firstName: '{firstName}', lastName: '{lastName}', phone: '{phone}', company: '{company}', customFields: '{customFields}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'subscribers.find',
      class: 'read',
      description: 'Search for a subscriber by email or ID.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address to search' },
          id: { type: 'string', description: 'Contact ID to search' },
          skip: { type: 'integer', description: 'Number of records to skip' },
          take: { type: 'integer', description: 'Maximum number of records to return' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/subscribers', query: { email: '{email}', id: '{id}', skip: '{skip}', take: '{take}' } },
    },
    {
      name: 'subscribers.unsubscribe',
      class: 'mutation',
      description: 'Unsubscribe a contact from a list.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Contact ID to unsubscribe' },
          reason: { type: 'string', description: 'Reason for unsubscribing' },
        },
        required: ['id', 'reason'],
      },
      request: { method: 'POST', path: '/subscribers/{id}/unsubscribe', body: { reason: '{reason}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a new email list.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the list' },
          publicName: { type: 'string', description: 'Public-facing name of the list' },
          publicDescription: { type: 'string', description: 'Public description of the list' },
          isPublic: { type: 'boolean', description: 'Make this list publicly visible' },
          allowsUsersToSubscribe: { type: 'boolean', description: 'Allow users to subscribe themselves' },
          allowsUsersToUnsubscribe: { type: 'boolean', description: 'Allow users to unsubscribe themselves' },
        },
        required: ['name', 'isPublic', 'allowsUsersToSubscribe', 'allowsUsersToUnsubscribe'],
      },
      request: { method: 'POST', path: '/lists', body: { name: '{name}', publicName: '{publicName}', publicDescription: '{publicDescription}', isPublic: '{isPublic}', allowsUsersToSubscribe: '{allowsUsersToSubscribe}', allowsUsersToUnsubscribe: '{allowsUsersToUnsubscribe}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'subscribers.update',
      class: 'mutation',
      description: 'Update subscriber fields.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Contact ID' },
          data: { type: 'object', description: 'Subscriber fields to update' },
        },
        required: ['id', 'data'],
      },
      request: { method: 'PUT', path: '/subscribers/{id}', body: '{data}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscribers.delete',
      class: 'mutation',
      description: 'Delete a subscriber.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Contact ID to delete' },
        },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/subscribers/{id}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.delete',
      class: 'mutation',
      description: 'Delete a list.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'List ID to delete' },
        },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/lists/{id}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'campaigns.send',
      class: 'mutation',
      description: 'Send or trigger a campaign.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Campaign ID to send' },
        },
        required: ['id'],
      },
      request: { method: 'POST', path: '/campaigns/{id}/send' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
