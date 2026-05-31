import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Pushover connector.
 *
 * Pushover is a push-notification service that delivers real-time alerts to
 * mobile devices and desktops. The external integration surface exposes the
 * send-notification endpoint, which requires an API token (application key)
 * and user key to deliver messages to user devices.
 *
 * Auth is via two API keys: the application/API token and the user key.
 * These are delivered as form-encoded parameters on every request.
 *
 * Consistency: notifications are fire-and-forget (write-only, non-deterministic
 * delivery due to network/device state). CAS posture is `none` — the caller owns
 * idempotency if needed — and `externalEffect: true` so the orchestrator's
 * dry-run policy treats this as a side-effecting call.
 */
export const pushoverConnector = declarativeRestConnector({
  kind: 'pushover',
  displayName: 'Pushover',
  description: 'Send push notifications to devices via Pushover.',
  auth: {
    kind: 'api-key',
    hint: 'Pushover API token (application key) and user key. Both are required.',
  },
  category: 'comms',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.pushover.net/1',
  defaultHeaders: {
    'content-type': 'application/x-www-form-urlencoded',
  },
  test: { method: 'POST', path: '/users/validate.json', body: { user: '{user_key}', token: '{api_token}' } },
  capabilities: [
    {
      name: 'notifications.send',
      class: 'mutation',
      description: 'Send a push notification to a Pushover user or group.',
      parameters: {
        type: 'object',
        properties: {
          api_token: {
            type: 'string',
            description: 'Pushover application API token/key.',
          },
          user_key: {
            type: 'string',
            description: 'Pushover user key or group key to send the notification to.',
          },
          message: {
            type: 'string',
            description: 'The message body to send.',
          },
          title: {
            type: 'string',
            description: 'Optional title for the notification.',
          },
          priority: {
            type: 'integer',
            description:
              'Priority level of the notification (-2 to 2). -2 is lowest, 2 is emergency. Default is 0.',
          },
          url: {
            type: 'string',
            description: 'Optional supplementary URL to include with the message.',
          },
          url_title: {
            type: 'string',
            description: 'Optional title for the supplementary URL.',
          },
          device: {
            type: 'string',
            description: 'Optional device name to send to. If omitted, sends to all user devices.',
          },
          html: {
            type: 'boolean',
            description: 'Optional flag to enable HTML parsing in the message body.',
          },
          timestamp: {
            type: 'string',
            description: 'Optional Unix timestamp to display instead of the current time.',
          },
          retry: {
            type: 'integer',
            description: 'Optional retry interval in seconds. Only applicable when priority is 2.',
          },
          expire: {
            type: 'integer',
            description: 'Optional expiration time in seconds. Only applicable when priority is 2.',
          },
        },
        required: ['api_token', 'user_key', 'message'],
      },
      request: {
        method: 'POST',
        path: '/messages.json',
        body: 'args',
      },
      cas: 'none',
      externalEffect: true,
    },
  ],
})
