import { declarativeRestConnector } from './declarative-rest.js'

/**
 * LogSnag — project event tracking and lightweight product analytics.
 *
 * The activepieces catalog only declares the `createEvent` action; LogSnag's
 * public HTTP API (https://docs.logsnag.com/api-reference) is small and fully
 * shaped around `project` + `channel` keys, so the surface below is the real
 * set of endpoints a caller can reach with a single API token: `log` (event),
 * `identify` (user trait), `group` (group trait), `insight` (numeric metric),
 * and `insight/mutate` (atomic counter update).
 *
 * Auth: a single bearer API token, scoped to a LogSnag project. The catalog
 * marks `project` / `channel` / `event` as required text fields — those flow
 * through as capability parameters rather than connector-construction config
 * so a single connection can target multiple channels in the same project.
 */
export const logsnagConnector = declarativeRestConnector({
  kind: 'logsnag',
  displayName: 'LogSnag',
  description: 'Track project events, identify users, and update insight counters in LogSnag.',
  auth: { kind: 'api-key', hint: 'LogSnag project API token (Authorization: Bearer …).' },
  category: 'comms',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.logsnag.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'Content-Type': 'application/json' },
  test: { method: 'GET', path: '/v1/health' },
  capabilities: [
    {
      name: 'create.event',
      class: 'mutation',
      description:
        'Publish an event to a LogSnag channel. Mirrors the activepieces createEvent action — project, channel, and event are required; description, icon, notify, and tags are optional.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'LogSnag project slug the event belongs to.' },
          channel: { type: 'string', description: 'Channel within the project (e.g. "signups").' },
          event: { type: 'string', description: 'Short event title shown in the LogSnag feed.' },
          description: { type: 'string', description: 'Optional longer body for the event.' },
          icon: { type: 'string', description: 'Optional single emoji shown next to the event.' },
          notify: { type: 'boolean', description: 'When true, send a push notification to subscribers.' },
          tags: {
            type: 'object',
            description: 'Free-form key/value tags. Keys must be lowercase and dash-separated.',
          },
          user_id: { type: 'string', description: 'Optional user identifier to attach to the event.' },
          parser: { type: 'string', enum: ['markdown', 'text'], description: 'Renderer for description.' },
          timestamp: { type: 'integer', description: 'Optional unix-seconds timestamp; defaults to now.' },
        },
        required: ['project', 'channel', 'event'],
      },
      request: {
        method: 'POST',
        path: '/v1/log',
        body: {
          project: '{project}',
          channel: '{channel}',
          event: '{event}',
          description: '{description}',
          icon: '{icon}',
          notify: '{notify}',
          tags: '{tags}',
          user_id: '{user_id}',
          parser: '{parser}',
          timestamp: '{timestamp}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'identify.user',
      class: 'mutation',
      description:
        'Attach trait properties to a user identifier inside a LogSnag project. Properties are merged server-side.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          user_id: { type: 'string', description: 'Stable user identifier.' },
          properties: { type: 'object', description: 'Trait key/value pairs to merge.' },
        },
        required: ['project', 'user_id', 'properties'],
      },
      request: {
        method: 'POST',
        path: '/v1/identify',
        body: {
          project: '{project}',
          user_id: '{user_id}',
          properties: '{properties}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'group.identify',
      class: 'mutation',
      description: 'Attach trait properties to a group (org/team) identifier inside a LogSnag project.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          group_id: { type: 'string' },
          properties: { type: 'object' },
        },
        required: ['project', 'group_id', 'properties'],
      },
      request: {
        method: 'POST',
        path: '/v1/group',
        body: {
          project: '{project}',
          group_id: '{group_id}',
          properties: '{properties}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'insight.publish',
      class: 'mutation',
      description: 'Upsert a numeric insight tile on a LogSnag project dashboard.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          title: { type: 'string', description: 'Human-readable insight title.' },
          value: { type: 'number', description: 'Numeric value to display.' },
          icon: { type: 'string', description: 'Optional emoji icon.' },
        },
        required: ['project', 'title', 'value'],
      },
      request: {
        method: 'POST',
        path: '/v1/insight',
        body: {
          project: '{project}',
          title: '{title}',
          value: '{value}',
          icon: '{icon}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'insight.mutate',
      class: 'mutation',
      description:
        'Atomically increment, decrement, or set an insight value by title. Use this for counters that must not race.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          title: { type: 'string' },
          value: {
            type: 'object',
            description: 'Atomic mutation, e.g. { "$inc": 1 } or { "$set": 42 }.',
          },
          icon: { type: 'string' },
        },
        required: ['project', 'title', 'value'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/insight',
        body: {
          project: '{project}',
          title: '{title}',
          value: '{value}',
          icon: '{icon}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
