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
  ],
})
