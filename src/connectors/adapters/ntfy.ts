import { declarativeRestConnector } from './declarative-rest.js'

export const ntfyConnector = declarativeRestConnector({
  kind: 'ntfy',
  displayName: 'Ntfy',
  description: 'Send push notifications to Ntfy topics.',
  auth: { kind: 'api-key', hint: 'Ntfy server URL and optional access token.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'base_url' },
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'send.notification',
      class: 'mutation',
      description: 'Send a notification to an Ntfy topic.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'The topic/channel to send to' },
          message: { type: 'string', description: 'The message body' },
          title: { type: 'string', description: 'Optional notification title' },
          priority: { type: 'string', description: 'Priority level (1-5, default 3)' },
          tags: { type: 'object', description: 'Optional tags object' },
          icon: { type: 'string', description: 'Optional icon URL' },
          actions: { type: 'string', description: 'Optional action buttons JSON' },
          click: { type: 'string', description: 'Optional click URL' },
          delay: { type: 'string', description: 'Optional delay specification' },
        },
        required: ['topic', 'message'],
      },
      request: {
        method: 'POST',
        path: '/{topic}',
        headers: {
          'X-Title': '{title}',
          'X-Priority': '{priority}',
          'X-Tags': '{tags}',
          'X-Icon': '{icon}',
          'X-Actions': '{actions}',
          'X-Click': '{click}',
          'X-Delay': '{delay}',
        },
        body: '{message}',
      },
      cas: 'native-idempotency',
    },
  ],
})
