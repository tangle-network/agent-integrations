import { declarativeRestConnector } from './declarative-rest.js'

export const dittofeedConnector = declarativeRestConnector({
  kind: 'dittofeed',
  displayName: 'Dittofeed',
  description:
    'Send identify, track, and screen events to a self-hosted or cloud Dittofeed instance for customer messaging segmentation.',
  auth: { kind: 'api-key', hint: 'Dittofeed workspace API key for the public apps API.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://dittofeed.com' },
  test: { method: 'GET', path: '/api' },
  capabilities: [
    {
      name: 'users.identify',
      class: 'mutation',
      description: 'Identify a Dittofeed user, attaching traits to the user profile.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          traits: { type: 'object' },
          messageId: { type: 'string' },
          timestamp: { type: 'string' },
          context: { type: 'object' },
        },
        required: ['userId'],
      },
      request: {
        method: 'POST',
        path: '/api/public/apps/identify',
        body: {
          userId: '{userId}',
          traits: '{traits}',
          messageId: '{messageId}',
          timestamp: '{timestamp}',
          context: '{context}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'events.track',
      class: 'mutation',
      description: 'Track a named event for a Dittofeed user with optional properties.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          event: { type: 'string' },
          properties: { type: 'object' },
          messageId: { type: 'string' },
          timestamp: { type: 'string' },
          context: { type: 'object' },
        },
        required: ['userId', 'event'],
      },
      request: {
        method: 'POST',
        path: '/api/public/apps/track',
        body: {
          userId: '{userId}',
          event: '{event}',
          properties: '{properties}',
          messageId: '{messageId}',
          timestamp: '{timestamp}',
          context: '{context}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'screens.record',
      class: 'mutation',
      description: 'Record a screen view for a Dittofeed user with optional screen properties.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          name: { type: 'string' },
          properties: { type: 'object' },
          messageId: { type: 'string' },
          timestamp: { type: 'string' },
          context: { type: 'object' },
        },
        required: ['userId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/api/public/apps/screen',
        body: {
          userId: '{userId}',
          name: '{name}',
          properties: '{properties}',
          messageId: '{messageId}',
          timestamp: '{timestamp}',
          context: '{context}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
