import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Gameball adapter — REST API at https://api.gameball.co/api/v3.0.
 *
 * Auth: API key forwarded in the `apiKey` request header. Gameball does not
 * accept Authorization bearer tokens for the integration endpoints.
 *
 * Actions mirror the activepieces catalog entry for `gameball`: a single
 * `send.event` mutation that posts an event tied to a player. The catalog
 * exposes only one upstream action (`sendEvent`); additional reads here
 * (player lookup, balance) are intentionally omitted to stay 1:1 with the
 * catalog surface.
 */
export const gameballConnector = declarativeRestConnector({
  kind: 'gameball',
  displayName: 'Gameball',
  description:
    'Send player events to the Gameball loyalty + gamification platform to trigger rewards, challenges, and behavioral rules.',
  auth: {
    kind: 'api-key',
    hint: 'Gameball account API key — see help.gameball.co/en/articles/3467114.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.gameball.co/api/v3.0',
  credentialPlacement: { kind: 'header', header: 'apiKey' },
  test: {
    method: 'POST',
    path: '/integrations/event',
    body: {
      playerUniqueId: '__healthcheck__',
      events: { __healthcheck: {} },
    },
  },
  capabilities: [
    {
      name: 'send.event',
      class: 'mutation',
      description:
        'Send one or more behavioral events for a player. Each entry in `events` is keyed by event name (as configured in the Gameball dashboard) and triggers any rewards, challenges, or segmentation rules wired to that event.',
      parameters: {
        type: 'object',
        properties: {
          playerUniqueId: {
            type: 'string',
            description: 'Stable customer identifier used to attribute the event to a player.',
          },
          events: {
            type: 'object',
            description:
              'Map of event name to event metadata object. Example: { "purchase": { "amount": 50, "currency": "USD" } }.',
          },
          playerAttributes: {
            type: 'object',
            description:
              'Optional player attributes (email, displayName, mobile, custom attrs) updated on the player record alongside the event.',
          },
        },
        required: ['playerUniqueId', 'events'],
      },
      request: {
        method: 'POST',
        path: '/integrations/event',
        body: {
          playerUniqueId: '{playerUniqueId}',
          events: '{events}',
          playerAttributes: '{playerAttributes}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
