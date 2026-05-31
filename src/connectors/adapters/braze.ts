import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Braze REST API — customer lifecycle messaging (push / email / in-app / SMS).
 *
 * Auth: REST API key issued in the Braze dashboard (Settings → REST API Keys)
 * with the per-endpoint permissions the agent will call. Braze accepts the key
 * as a Bearer token, so the declarative REST runtime's default credential
 * placement works as-is.
 *
 * Base URL is per-instance: every Braze workspace lives in one of the named
 * REST endpoints (rest.iad-01.braze.com, rest.iad-02.braze.com,
 * rest.eu-01.braze.com, etc.). The customer picks it once at connection time
 * and we persist it on the data source `metadata.restEndpoint` field — the
 * adapter routes every request against that per-tenant base URL. No
 * fallback: a misconfigured connection fails loud at the first invocation
 * rather than silently calling someone else's cluster.
 *
 * Capability surface covers the four flows agents actually need on Braze:
 *   - `users.track`        — server-side event / attribute / purchase ingest
 *   - `users.identify`     — alias→external_id reconciliation
 *   - `users.export`       — read user profiles by external_id / braze_id / email
 *   - `subscription.status.set` — manage marketing/transactional opt-state
 *   - `campaigns.trigger.send` and `canvas.trigger.send` — API-triggered sends
 *   - `email.blacklist`    — suppress an address from future sends
 *
 * Every mutation uses native idempotency where Braze supports it
 * (`/users/track` is deterministic on `external_id`+`name`+`time`; campaign
 * triggers accept a `dispatch_id` echo) and `external-effect: true` so the
 * hub guard records the side effect even on replay.
 */
export const brazeConnector = declarativeRestConnector({
  kind: 'braze',
  displayName: 'Braze',
  description: 'Track Braze users, trigger campaign/canvas sends, and manage subscription state through the REST API.',
  auth: {
    kind: 'api-key',
    hint: 'Braze REST API key from Settings → REST API Keys with the per-endpoint permissions the agent needs (users.track, campaigns.trigger.send, etc.).',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'restEndpoint' },
  test: { method: 'GET', path: '/email/hard_bounces?limit=1' },
  capabilities: [
    {
      name: 'users.track',
      class: 'mutation',
      description: 'Server-side ingest of user attributes, custom events, and purchases (POST /users/track).',
      parameters: {
        type: 'object',
        properties: {
          attributes: {
            type: 'array',
            description: 'User attribute updates keyed by external_id or braze_id.',
            items: {
              type: 'object',
              properties: {
                external_id: { type: 'string' },
                braze_id: { type: 'string' },
                user_alias: {
                  type: 'object',
                  properties: {
                    alias_name: { type: 'string' },
                    alias_label: { type: 'string' },
                  },
                  required: ['alias_name', 'alias_label'],
                },
                _update_existing_only: { type: 'boolean' },
              },
              additionalProperties: true,
            },
          },
          events: {
            type: 'array',
            description: 'Custom events with name, time (ISO-8601), and optional properties.',
            items: {
              type: 'object',
              properties: {
                external_id: { type: 'string' },
                braze_id: { type: 'string' },
                user_alias: {
                  type: 'object',
                  properties: {
                    alias_name: { type: 'string' },
                    alias_label: { type: 'string' },
                  },
                  required: ['alias_name', 'alias_label'],
                },
                app_id: { type: 'string' },
                name: { type: 'string' },
                time: { type: 'string' },
                properties: { type: 'object' },
                _update_existing_only: { type: 'boolean' },
              },
              required: ['name', 'time'],
            },
          },
          purchases: {
            type: 'array',
            description: 'Purchase records with product_id, currency, price, time.',
            items: {
              type: 'object',
              properties: {
                external_id: { type: 'string' },
                braze_id: { type: 'string' },
                user_alias: {
                  type: 'object',
                  properties: {
                    alias_name: { type: 'string' },
                    alias_label: { type: 'string' },
                  },
                  required: ['alias_name', 'alias_label'],
                },
                app_id: { type: 'string' },
                product_id: { type: 'string' },
                currency: { type: 'string' },
                price: { type: 'number' },
                quantity: { type: 'integer' },
                time: { type: 'string' },
                properties: { type: 'object' },
                _update_existing_only: { type: 'boolean' },
              },
              required: ['product_id', 'currency', 'price', 'time'],
            },
          },
        },
      },
      request: { method: 'POST', path: '/users/track', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'users.identify',
      class: 'mutation',
      description: 'Merge a user_alias profile onto an external_id (POST /users/identify).',
      parameters: {
        type: 'object',
        properties: {
          aliases_to_identify: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                external_id: { type: 'string' },
                user_alias: {
                  type: 'object',
                  properties: {
                    alias_name: { type: 'string' },
                    alias_label: { type: 'string' },
                  },
                  required: ['alias_name', 'alias_label'],
                },
              },
              required: ['external_id', 'user_alias'],
            },
          },
          merge_behavior: {
            type: 'string',
            enum: ['none', 'merge'],
            description: 'How to reconcile attributes when both records exist.',
          },
        },
        required: ['aliases_to_identify'],
      },
      request: { method: 'POST', path: '/users/identify', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'users.export.ids',
      class: 'read',
      description: 'Export user profiles by external_id, user_alias, braze_id, email_address, or phone (POST /users/export/ids).',
      parameters: {
        type: 'object',
        properties: {
          external_ids: { type: 'array', items: { type: 'string' } },
          user_aliases: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                alias_name: { type: 'string' },
                alias_label: { type: 'string' },
              },
              required: ['alias_name', 'alias_label'],
            },
          },
          device_id: { type: 'string' },
          braze_id: { type: 'string' },
          email_address: { type: 'string' },
          phone: { type: 'string' },
          fields_to_export: { type: 'array', items: { type: 'string' } },
        },
      },
      request: { method: 'POST', path: '/users/export/ids', body: 'args' },
    },
    {
      name: 'users.delete',
      class: 'mutation',
      description: 'Delete user profiles by external_id, user_alias, or braze_id (POST /users/delete).',
      parameters: {
        type: 'object',
        properties: {
          external_ids: { type: 'array', items: { type: 'string' } },
          user_aliases: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                alias_name: { type: 'string' },
                alias_label: { type: 'string' },
              },
              required: ['alias_name', 'alias_label'],
            },
          },
          braze_ids: { type: 'array', items: { type: 'string' } },
        },
      },
      request: { method: 'POST', path: '/users/delete', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'campaigns.trigger.send',
      class: 'mutation',
      description: 'Fire an API-triggered Braze campaign send (POST /campaigns/trigger/send).',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string' },
          send_id: { type: 'string', description: 'Optional dispatch_id echoed back for tracking; pass a deterministic value to dedupe.' },
          trigger_properties: { type: 'object' },
          broadcast: { type: 'boolean' },
          audience: { type: 'object', description: 'Connected audience segment filter object.' },
          recipients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                external_user_id: { type: 'string' },
                user_alias: {
                  type: 'object',
                  properties: {
                    alias_name: { type: 'string' },
                    alias_label: { type: 'string' },
                  },
                  required: ['alias_name', 'alias_label'],
                },
                trigger_properties: { type: 'object' },
                send_to_existing_only: { type: 'boolean' },
                attributes: { type: 'object' },
              },
            },
          },
        },
        required: ['campaign_id'],
      },
      request: { method: 'POST', path: '/campaigns/trigger/send', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'canvas.trigger.send',
      class: 'mutation',
      description: 'Fire an API-triggered Braze Canvas send (POST /canvas/trigger/send).',
      parameters: {
        type: 'object',
        properties: {
          canvas_id: { type: 'string' },
          canvas_entry_properties: { type: 'object' },
          broadcast: { type: 'boolean' },
          audience: { type: 'object' },
          recipients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                external_user_id: { type: 'string' },
                user_alias: {
                  type: 'object',
                  properties: {
                    alias_name: { type: 'string' },
                    alias_label: { type: 'string' },
                  },
                  required: ['alias_name', 'alias_label'],
                },
                canvas_entry_properties: { type: 'object' },
                send_to_existing_only: { type: 'boolean' },
                attributes: { type: 'object' },
              },
            },
          },
        },
        required: ['canvas_id'],
      },
      request: { method: 'POST', path: '/canvas/trigger/send', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscription.status.set',
      class: 'mutation',
      description: 'Update subscription state for a list of users on a subscription group (POST /subscription/status/set).',
      parameters: {
        type: 'object',
        properties: {
          subscription_group_id: { type: 'string' },
          subscription_state: { type: 'string', enum: ['subscribed', 'unsubscribed'] },
          external_id: {
            description: 'External user id (string) or array of external user ids.',
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          email: {
            description: 'Email (string) or array of emails.',
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
          phone: {
            description: 'E.164 phone (string) or array of E.164 phones.',
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
        },
        required: ['subscription_group_id', 'subscription_state'],
      },
      request: { method: 'POST', path: '/subscription/status/set', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscription.status.get',
      class: 'read',
      description: 'Read subscription state for users on a subscription group (GET /subscription/status/get).',
      parameters: {
        type: 'object',
        properties: {
          subscription_group_id: { type: 'string' },
          external_id: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['subscription_group_id'],
      },
      request: {
        method: 'GET',
        path: '/subscription/status/get',
        query: {
          subscription_group_id: '{subscription_group_id}',
          external_id: '{external_id}',
          email: '{email}',
          phone: '{phone}',
        },
      },
    },
    {
      name: 'email.blacklist',
      class: 'mutation',
      description: 'Suppress one or more email addresses from future Braze sends (POST /email/blacklist).',
      parameters: {
        type: 'object',
        properties: {
          email: {
            description: 'Email (string) or array of emails to suppress.',
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } },
            ],
          },
        },
        required: ['email'],
      },
      request: { method: 'POST', path: '/email/blacklist', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'campaigns.list',
      class: 'read',
      description: 'List Braze campaigns ordered by last edit time (GET /campaigns/list).',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 0 },
          include_archived: { type: 'boolean' },
          sort_direction: { type: 'string', enum: ['asc', 'desc'] },
          last_edit_time_gt: { type: 'string', description: 'ISO-8601 lower bound on last_edit.time filter.' },
        },
      },
      request: {
        method: 'GET',
        path: '/campaigns/list',
        query: {
          page: '{page}',
          include_archived: '{include_archived}',
          sort_direction: '{sort_direction}',
          'last_edit.time[gt]': '{last_edit_time_gt}',
        },
      },
    },
    {
      name: 'canvas.list',
      class: 'read',
      description: 'List Braze Canvases ordered by last edit time (GET /canvas/list).',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 0 },
          include_archived: { type: 'boolean' },
          sort_direction: { type: 'string', enum: ['asc', 'desc'] },
          last_edit_time_gt: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/canvas/list',
        query: {
          page: '{page}',
          include_archived: '{include_archived}',
          sort_direction: '{sort_direction}',
          'last_edit.time[gt]': '{last_edit_time_gt}',
        },
      },
    },
  ],
})
