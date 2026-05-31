import { declarativeRestConnector } from './declarative-rest.js'

// Calendly v2 REST API. Bearer-OAuth2 against api.calendly.com.
// Resource URIs in Calendly are full https URLs (e.g. "https://api.calendly.com/users/UUID"),
// so capability args that take a `user` / `event_type` / `organization` MUST be the full URI,
// not a bare UUID — mirroring Calendly's own SDK convention.
export const calendlyConnector = declarativeRestConnector({
  kind: 'calendly',
  displayName: 'Calendly',
  description: 'Read Calendly event types and scheduled events, cancel events, and create single-use scheduling links.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://auth.calendly.com/oauth/authorize',
    tokenUrl: 'https://auth.calendly.com/oauth/token',
    // Calendly OAuth2 grants are account-wide; the authorize endpoint does not accept a `scope` parameter.
    scopes: [],
    clientIdEnv: 'CALENDLY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CALENDLY_OAUTH_CLIENT_SECRET',
  },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.calendly.com',
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'user.get-current',
      class: 'read',
      description: 'Get the authenticated Calendly user.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/users/me' },
    },
    {
      name: 'event-types.list',
      class: 'read',
      description: 'List event types owned by a user or organization.',
      parameters: {
        type: 'object',
        properties: {
          user: { type: 'string', description: 'Full user URI (https://api.calendly.com/users/UUID).' },
          organization: { type: 'string', description: 'Full organization URI.' },
          active: { type: 'boolean' },
          count: { type: 'integer', minimum: 1, maximum: 100 },
          page_token: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/event_types',
        query: {
          user: '{user}',
          organization: '{organization}',
          active: '{active}',
          count: '{count}',
          page_token: '{page_token}',
        },
      },
    },
    {
      name: 'event-types.get',
      class: 'read',
      description: 'Read a single event type by UUID.',
      parameters: {
        type: 'object',
        properties: { uuid: { type: 'string' } },
        required: ['uuid'],
      },
      request: { method: 'GET', path: '/event_types/{uuid}' },
    },
    {
      name: 'scheduled-events.list',
      class: 'read',
      description: 'List scheduled events for a user or organization, optionally filtered by status and time window.',
      parameters: {
        type: 'object',
        properties: {
          user: { type: 'string', description: 'Full user URI.' },
          organization: { type: 'string', description: 'Full organization URI.' },
          status: { type: 'string', enum: ['active', 'canceled'] },
          min_start_time: { type: 'string', description: 'ISO-8601 lower bound.' },
          max_start_time: { type: 'string', description: 'ISO-8601 upper bound.' },
          count: { type: 'integer', minimum: 1, maximum: 100 },
          page_token: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/scheduled_events',
        query: {
          user: '{user}',
          organization: '{organization}',
          status: '{status}',
          min_start_time: '{min_start_time}',
          max_start_time: '{max_start_time}',
          count: '{count}',
          page_token: '{page_token}',
        },
      },
    },
    {
      name: 'scheduled-events.get',
      class: 'read',
      description: 'Read a single scheduled event by UUID.',
      parameters: {
        type: 'object',
        properties: { uuid: { type: 'string' } },
        required: ['uuid'],
      },
      request: { method: 'GET', path: '/scheduled_events/{uuid}' },
    },
    {
      name: 'scheduled-events.list-invitees',
      class: 'read',
      description: 'List invitees on a scheduled event.',
      parameters: {
        type: 'object',
        properties: {
          uuid: { type: 'string' },
          status: { type: 'string', enum: ['active', 'canceled'] },
          email: { type: 'string' },
          count: { type: 'integer', minimum: 1, maximum: 100 },
          page_token: { type: 'string' },
        },
        required: ['uuid'],
      },
      request: {
        method: 'GET',
        path: '/scheduled_events/{uuid}/invitees',
        query: {
          status: '{status}',
          email: '{email}',
          count: '{count}',
          page_token: '{page_token}',
        },
      },
    },
    {
      name: 'scheduled-events.cancel',
      class: 'mutation',
      description: 'Cancel a scheduled event with an optional reason shown to the invitee.',
      parameters: {
        type: 'object',
        properties: {
          uuid: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['uuid'],
      },
      request: {
        method: 'POST',
        path: '/scheduled_events/{uuid}/cancellation',
        body: { reason: '{reason}' },
      },
      // Calendly cancellation is idempotent per event UUID — a second call against an already-canceled event 4xxs with a stable error.
      cas: 'native-idempotency',
    },
    {
      name: 'scheduling-links.create',
      class: 'mutation',
      description: 'Create a single-use scheduling link for an event type.',
      parameters: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Full event-type URI to attach the link to.' },
          max_event_count: { type: 'integer', minimum: 1, default: 1 },
        },
        required: ['owner'],
      },
      request: {
        method: 'POST',
        path: '/scheduling_links',
        body: {
          owner: '{owner}',
          owner_type: 'EventType',
          max_event_count: '{max_event_count}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
