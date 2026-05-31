import { declarativeRestConnector } from './declarative-rest.js'

export const anyhookWebsocketConnector = declarativeRestConnector({
  kind: 'anyhook-websocket',
  displayName: 'AnyHook Websocket',
  description: 'Subscribe and listen to websocket events through AnyHook proxy server for real-time communication.',
  auth: {
    kind: 'api-key',
    hint: 'AnyHook server URL and websocket endpoint.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'proxyBaseUrl' },
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'websocket.subscribe',
      class: 'read',
      description: 'Subscribe to websocket events from AnyHook endpoint.',
      parameters: {
        type: 'object',
        properties: {
          websocketUrl: { type: 'string', description: 'Websocket endpoint URL to connect to' },
          subscriptionMessage: { type: 'object', description: 'Message to send to subscribe to events' },
          headers: { type: 'object', description: 'Optional custom headers for the connection' },
        },
        required: ['websocketUrl', 'subscriptionMessage'],
      },
      request: {
        method: 'POST',
        path: '/subscribe',
        body: {
          url: '{websocketUrl}',
          message: '{subscriptionMessage}',
          headers: '{headers}',
        },
      },
    },
  ],
})
