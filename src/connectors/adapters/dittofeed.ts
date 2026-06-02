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
    {
      // Dittofeed treats identify with traits as upsert; this is the canonical
      // "subscriber.create" entrypoint per the apps API (no separate POST
      // /subscribers exists on the public surface). Forwards the full args
      // object so optional fields (email, phone, subscriptionGroupId, traits,
      // messageId, timestamp) are passed through verbatim when present and
      // omitted when absent.
      name: 'subscribers.create',
      class: 'mutation',
      description:
        'Add or update a subscriber by identifying the user and persisting subscriber traits (email, phone, subscription groups).',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          traits: { type: 'object' },
          subscriptionGroupId: { type: 'string' },
          messageId: { type: 'string' },
          timestamp: { type: 'string' },
        },
        required: ['userId'],
      },
      request: {
        method: 'POST',
        path: '/api/public/apps/identify',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      // Dittofeed's public API has no DELETE subscriber endpoint; the
      // documented removal path is a tracked Subscription Cancelled event,
      // which the journey/segment engine consumes to remove the user from
      // subscription groups. Caller passes the subscription group id so the
      // event carries the membership being severed.
      name: 'subscribers.delete',
      class: 'mutation',
      description:
        'Delete a subscriber by emitting a Subscription Cancelled event (Dittofeed has no public hard-delete; this is the documented removal path).',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          subscriptionGroupId: { type: 'string' },
        },
        required: ['userId', 'subscriptionGroupId'],
      },
      request: {
        method: 'POST',
        path: '/api/public/apps/track',
        body: {
          userId: '{userId}',
          event: 'Subscription Cancelled',
          properties: { subscriptionGroupId: '{subscriptionGroupId}' },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'broadcast.send',
      class: 'mutation',
      description:
        'Trigger a Dittofeed broadcast by id. The broadcast must already be defined in the workspace; this dispatches it to the configured audience.',
      parameters: {
        type: 'object',
        properties: {
          broadcastId: { type: 'string' },
          workspaceId: { type: 'string' },
        },
        required: ['broadcastId'],
      },
      request: {
        method: 'POST',
        path: '/api/admin/broadcasts/trigger',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'journey.trigger',
      class: 'mutation',
      description:
        'Trigger a Dittofeed journey for a specific user. The journey id must reference a published journey in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          journeyId: { type: 'string' },
          userId: { type: 'string' },
          workspaceId: { type: 'string' },
          context: { type: 'object' },
        },
        required: ['journeyId', 'userId'],
      },
      request: {
        method: 'POST',
        path: '/api/admin/journeys/trigger',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
