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
    {
      name: 'player.create',
      class: 'mutation',
      description:
        'Create or upsert a Gameball player. Idempotent on `playerUniqueId` — first call creates, subsequent calls update player attributes (email, displayName, mobile, gender, dateOfBirth, custom attributes).',
      parameters: {
        type: 'object',
        properties: {
          playerUniqueId: {
            type: 'string',
            description: 'Stable customer identifier; upserts the player record.',
          },
          playerAttributes: {
            type: 'object',
            description:
              'Player profile fields — email, displayName, firstName, lastName, mobile, gender, dateOfBirth, custom attributes.',
          },
          referrerCode: {
            type: 'string',
            description: 'Optional referrer code that attributes this player to an existing referrer.',
          },
        },
        required: ['playerUniqueId'],
      },
      request: {
        method: 'POST',
        path: '/integrations/player',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'action.track',
      class: 'mutation',
      description:
        'Track a single gamification action for a player. Convenience over `send.event` for emitting one named action with metadata, body, and reward overrides — fires the loyalty rules wired to that action name.',
      parameters: {
        type: 'object',
        properties: {
          playerUniqueId: {
            type: 'string',
            description: 'Stable customer identifier.',
          },
          events: {
            type: 'object',
            description:
              'Map of action name to action metadata. Example: { "review_left": { "rating": 5 } }.',
          },
          playerAttributes: {
            type: 'object',
            description:
              'Optional player attribute updates applied alongside the action.',
          },
        },
        required: ['playerUniqueId', 'events'],
      },
      request: {
        method: 'POST',
        path: '/integrations/event',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'reward.redeem',
      class: 'mutation',
      description:
        'Redeem a reward for a player. `rewardConstraints` selects the reward (rewardId or rewardType + amount); the call debits the appropriate balance and emits a redemption event.',
      parameters: {
        type: 'object',
        properties: {
          playerUniqueId: {
            type: 'string',
            description: 'Stable customer identifier.',
          },
          rewardConstraints: {
            type: 'object',
            description:
              'Reward selector — rewardId, rewardType, amount, currency per the Gameball redeem schema.',
          },
          transactionId: {
            type: 'string',
            description: 'Caller-supplied transaction id for idempotency on the redemption record.',
          },
        },
        required: ['playerUniqueId', 'rewardConstraints'],
      },
      request: {
        method: 'POST',
        path: '/integrations/redeem',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
