import { declarativeRestConnector } from './declarative-rest.js'

// AMPECO is a multi-tenant EV-charging platform. Each operator runs on its own
// subdomain (e.g. https://acme.platform.ampeco.com/api), so the base URL is
// pulled from per-DataSource metadata. The activepieces piece itself models
// AMPECO under the "webhook" category because its primary integration surface
// is the Notifications API (subscribe + receive event callbacks); we keep that
// category here for catalog parity. Public REST endpoints under /public/v1/...
// follow the AMPECO Public API reference.
export const ampecoConnector = declarativeRestConnector({
  kind: 'ampeco',
  displayName: 'AMPECO',
  description:
    'Manage AMPECO EV-charging infrastructure: charge points, EVSEs, sessions, tariffs, users, and webhook notification subscriptions.',
  auth: { kind: 'api-key', hint: 'AMPECO Public API token (Bearer).' },
  category: 'webhook',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instanceUrl', fallback: 'https://platform.ampeco.com/api' },
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { Accept: 'application/json' },
  test: { method: 'GET', path: '/public/v1/charge-points', query: { 'page[size]': 1 } },
  capabilities: [
    // ---------- Charge points ----------
    {
      name: 'charge.points.list',
      class: 'read',
      description: 'List charge points across the operator network.',
      parameters: {
        type: 'object',
        properties: {
          pageSize: { type: 'integer' },
          pageNumber: { type: 'integer' },
          filter: { type: 'string', description: 'AMPECO filter expression (filter[...]).' },
        },
      },
      request: {
        method: 'GET',
        path: '/public/v1/charge-points',
        query: { 'page[size]': '{pageSize}', 'page[number]': '{pageNumber}', filter: '{filter}' },
      },
    },
    {
      name: 'charge.point.read',
      class: 'read',
      description: 'Get a single charge point by ID.',
      parameters: {
        type: 'object',
        properties: { chargePoint: { type: 'integer' } },
        required: ['chargePoint'],
      },
      request: { method: 'GET', path: '/public/v1/charge-points/{chargePoint}' },
    },
    {
      name: 'charge.point.change.availability',
      class: 'mutation',
      description:
        'Change the operational availability of a charge point or one of its connectors (Operative/Inoperative).',
      parameters: {
        type: 'object',
        properties: {
          chargePoint: { type: 'integer' },
          evseNetworkId: { type: 'integer' },
          type: { type: 'string', enum: ['Operative', 'Inoperative'] },
        },
        required: ['chargePoint', 'type'],
      },
      request: {
        method: 'POST',
        path: '/public/v1/charge-points/{chargePoint}/change-availability',
        body: { evseNetworkId: '{evseNetworkId}', type: '{type}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'charge.point.reset',
      class: 'mutation',
      description: 'Issue a Soft or Hard reset to a charge point.',
      parameters: {
        type: 'object',
        properties: {
          chargePoint: { type: 'integer' },
          type: { type: 'string', enum: ['Soft', 'Hard'] },
        },
        required: ['chargePoint', 'type'],
      },
      request: {
        method: 'POST',
        path: '/public/v1/charge-points/{chargePoint}/reset',
        body: { type: '{type}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'charge.point.start.charging.session',
      class: 'mutation',
      description: 'Start a remote charging session on a given EVSE of a charge point.',
      parameters: {
        type: 'object',
        properties: {
          chargePoint: { type: 'integer' },
          evseNetworkId: { type: 'integer' },
          userId: { type: 'integer' },
        },
        required: ['chargePoint', 'evseNetworkId'],
      },
      request: {
        method: 'POST',
        path: '/public/v1/charge-points/{chargePoint}/start-session',
        body: { evseNetworkId: '{evseNetworkId}', userId: '{userId}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'charge.point.stop.charging.session',
      class: 'mutation',
      description: 'Stop a running charging session on a charge point EVSE.',
      parameters: {
        type: 'object',
        properties: {
          chargePoint: { type: 'integer' },
          evseNetworkId: { type: 'integer' },
        },
        required: ['chargePoint', 'evseNetworkId'],
      },
      request: {
        method: 'POST',
        path: '/public/v1/charge-points/{chargePoint}/stop-session',
        body: { evseNetworkId: '{evseNetworkId}' },
      },
      cas: 'optimistic-read-verify',
    },

    // ---------- EVSEs ----------
    {
      name: 'evses.list',
      class: 'read',
      description: 'List EVSE connectors.',
      parameters: {
        type: 'object',
        properties: { pageSize: { type: 'integer' }, pageNumber: { type: 'integer' } },
      },
      request: {
        method: 'GET',
        path: '/public/v1/evses',
        query: { 'page[size]': '{pageSize}', 'page[number]': '{pageNumber}' },
      },
    },
    {
      name: 'evse.read',
      class: 'read',
      description: 'Get a single EVSE by ID.',
      parameters: {
        type: 'object',
        properties: { evse: { type: 'integer' } },
        required: ['evse'],
      },
      request: { method: 'GET', path: '/public/v1/evses/{evse}' },
    },

    // ---------- Sessions ----------
    {
      name: 'sessions.list',
      class: 'read',
      description: 'List charging sessions with optional date/user filters.',
      parameters: {
        type: 'object',
        properties: {
          pageSize: { type: 'integer' },
          pageNumber: { type: 'integer' },
          fromDate: { type: 'string', description: 'ISO 8601' },
          toDate: { type: 'string', description: 'ISO 8601' },
          userId: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/public/v1/sessions',
        query: {
          'page[size]': '{pageSize}',
          'page[number]': '{pageNumber}',
          'filter[from_date]': '{fromDate}',
          'filter[to_date]': '{toDate}',
          'filter[user_id]': '{userId}',
        },
      },
    },
    {
      name: 'session.read',
      class: 'read',
      description: 'Get a single charging session by ID.',
      parameters: {
        type: 'object',
        properties: { session: { type: 'integer' } },
        required: ['session'],
      },
      request: { method: 'GET', path: '/public/v1/sessions/{session}' },
    },

    // ---------- Locations ----------
    {
      name: 'locations.list',
      class: 'read',
      description: 'List charging locations.',
      parameters: {
        type: 'object',
        properties: { pageSize: { type: 'integer' }, pageNumber: { type: 'integer' } },
      },
      request: {
        method: 'GET',
        path: '/public/v1/locations',
        query: { 'page[size]': '{pageSize}', 'page[number]': '{pageNumber}' },
      },
    },
    {
      name: 'location.read',
      class: 'read',
      description: 'Get a charging location by ID.',
      parameters: {
        type: 'object',
        properties: { location: { type: 'integer' } },
        required: ['location'],
      },
      request: { method: 'GET', path: '/public/v1/locations/{location}' },
    },
    {
      name: 'location.create',
      class: 'mutation',
      description: 'Create a new charging location.',
      parameters: {
        type: 'object',
        properties: { data: { type: 'object' } },
        required: ['data'],
      },
      request: { method: 'POST', path: '/public/v1/locations', body: '{data}' },
      cas: 'native-idempotency',
    },
    {
      name: 'location.update',
      class: 'mutation',
      description: 'Update a charging location.',
      parameters: {
        type: 'object',
        properties: { location: { type: 'integer' }, data: { type: 'object' } },
        required: ['location', 'data'],
      },
      request: { method: 'PATCH', path: '/public/v1/locations/{location}', body: '{data}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'location.delete',
      class: 'mutation',
      description: 'Delete a charging location.',
      parameters: {
        type: 'object',
        properties: { location: { type: 'integer' } },
        required: ['location'],
      },
      request: { method: 'DELETE', path: '/public/v1/locations/{location}' },
      cas: 'optimistic-read-verify',
    },

    // ---------- Tariffs ----------
    {
      name: 'tariffs.list',
      class: 'read',
      description: 'List tariffs.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/public/v1/tariffs' },
    },
    {
      name: 'tariff.read',
      class: 'read',
      description: 'Get a single tariff by ID.',
      parameters: {
        type: 'object',
        properties: { tariff: { type: 'integer' } },
        required: ['tariff'],
      },
      request: { method: 'GET', path: '/public/v1/tariffs/{tariff}' },
    },
    {
      name: 'tariff.create',
      class: 'mutation',
      description: 'Create a tariff.',
      parameters: {
        type: 'object',
        properties: { data: { type: 'object' } },
        required: ['data'],
      },
      request: { method: 'POST', path: '/public/v1/tariffs', body: '{data}' },
      cas: 'native-idempotency',
    },
    {
      name: 'tariff.update',
      class: 'mutation',
      description: 'Update a tariff.',
      parameters: {
        type: 'object',
        properties: { tariff: { type: 'integer' }, data: { type: 'object' } },
        required: ['tariff', 'data'],
      },
      request: { method: 'PATCH', path: '/public/v1/tariffs/{tariff}', body: '{data}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tariff.delete',
      class: 'mutation',
      description: 'Delete a tariff.',
      parameters: {
        type: 'object',
        properties: { tariff: { type: 'integer' } },
        required: ['tariff'],
      },
      request: { method: 'DELETE', path: '/public/v1/tariffs/{tariff}' },
      cas: 'optimistic-read-verify',
    },

    // ---------- Users ----------
    {
      name: 'users.list',
      class: 'read',
      description: 'List end-user accounts.',
      parameters: {
        type: 'object',
        properties: { pageSize: { type: 'integer' }, pageNumber: { type: 'integer' } },
      },
      request: {
        method: 'GET',
        path: '/public/v1/users',
        query: { 'page[size]': '{pageSize}', 'page[number]': '{pageNumber}' },
      },
    },
    {
      name: 'user.read',
      class: 'read',
      description: 'Get an end-user account by ID.',
      parameters: {
        type: 'object',
        properties: { user: { type: 'integer' } },
        required: ['user'],
      },
      request: { method: 'GET', path: '/public/v1/users/{user}' },
    },
    {
      name: 'user.create',
      class: 'mutation',
      description: 'Create a new end-user account.',
      parameters: {
        type: 'object',
        properties: { data: { type: 'object' } },
        required: ['data'],
      },
      request: { method: 'POST', path: '/public/v1/users', body: '{data}' },
      cas: 'native-idempotency',
    },
    {
      name: 'user.update',
      class: 'mutation',
      description: 'Update an end-user account.',
      parameters: {
        type: 'object',
        properties: { user: { type: 'integer' }, data: { type: 'object' } },
        required: ['user', 'data'],
      },
      request: { method: 'PATCH', path: '/public/v1/users/{user}', body: '{data}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'user.delete',
      class: 'mutation',
      description: 'Delete an end-user account.',
      parameters: {
        type: 'object',
        properties: { user: { type: 'integer' } },
        required: ['user'],
      },
      request: { method: 'DELETE', path: '/public/v1/users/{user}' },
      cas: 'optimistic-read-verify',
    },

    // ---------- Notifications (webhook subscriptions) ----------
    {
      name: 'notifications.list',
      class: 'read',
      description: 'List webhook notification subscriptions.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/public/v1/notifications/subscriptions' },
    },
    {
      name: 'notifications.subscribe',
      class: 'mutation',
      description: 'Subscribe a webhook URL to one or more AMPECO event types.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          events: { type: 'array', items: { type: 'string' } },
          secret: { type: 'string' },
        },
        required: ['url', 'events'],
      },
      request: {
        method: 'POST',
        path: '/public/v1/notifications/subscriptions',
        body: { url: '{url}', events: '{events}', secret: '{secret}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'notifications.unsubscribe',
      class: 'mutation',
      description: 'Remove a webhook notification subscription by ID.',
      parameters: {
        type: 'object',
        properties: { subscription: { type: 'integer' } },
        required: ['subscription'],
      },
      request: { method: 'DELETE', path: '/public/v1/notifications/subscriptions/{subscription}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
  ],
})
