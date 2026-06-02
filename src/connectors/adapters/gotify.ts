import { declarativeRestConnector } from './declarative-rest.js'

export const gotifyConnector = declarativeRestConnector({
  kind: 'gotify',
  displayName: 'Gotify',
  description: 'Send push notifications to a self-hosted Gotify instance.',
  auth: { kind: 'api-key', hint: 'Gotify app token.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'base_url' },
  test: { method: 'GET', path: '/version' },
  capabilities: [
    {
      name: 'notification.send',
      class: 'mutation',
      description: 'Send a notification to Gotify.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          message: { type: 'string' },
          priority: { type: 'integer' },
        },
        required: ['title', 'message'],
      },
      request: {
        method: 'POST',
        path: '/message',
        query: { token: '{app_token}' },
        body: { title: '{title}', message: '{message}', priority: '{priority}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'message.send',
      class: 'mutation',
      description: 'Send a Gotify push notification (alias of notification.send for catalog discovery).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          message: { type: 'string' },
          priority: { type: 'integer' },
        },
        required: ['title', 'message'],
      },
      request: {
        method: 'POST',
        path: '/message',
        query: { token: '{app_token}' },
        body: { title: '{title}', message: '{message}', priority: '{priority}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'message.delete',
      class: 'mutation',
      description: 'Delete a previously sent Gotify message by id. Requires a Gotify client token in the {client_token} arg.',
      parameters: {
        type: 'object',
        properties: {
          messageId: { type: 'integer', description: 'Numeric Gotify message id to delete.' },
          client_token: { type: 'string', description: 'Gotify client token (not an app token) authorised to manage messages.' },
        },
        required: ['messageId', 'client_token'],
      },
      request: {
        method: 'DELETE',
        path: '/message/{messageId}',
        query: { token: '{client_token}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'application.create',
      class: 'mutation',
      description: 'Create a Gotify application and return the new application token. Requires a Gotify client token in the {client_token} arg.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name of the new application.' },
          description: { type: 'string', description: 'Optional human-readable description.' },
          client_token: { type: 'string', description: 'Gotify client token (not an app token) authorised to manage applications.' },
        },
        required: ['name', 'client_token'],
      },
      request: {
        method: 'POST',
        path: '/application',
        query: { token: '{client_token}' },
        body: { name: '{name}', description: '{description}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
