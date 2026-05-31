import { declarativeRestConnector } from './declarative-rest.js'

// Opsgenie OAuth 2.0 + REST surface.
//
// Auth: Opsgenie publishes a dedicated OAuth 2.0 authorization-code flow
// rooted at app.opsgenie.com (US) and app.eu.opsgenie.com (EU). The user-
// authorize redirect host is region-specific because Opsgenie keeps account
// data in the region the workspace was provisioned in. The orchestrator
// substitutes `{authHost}` from connection metadata (defaulting to the US
// host) when building the authorize URL; on the token-exchange leg the same
// host is used.
//   https://docs.opsgenie.com/docs/oauth
//
// API: every authenticated REST call lands on https://api.opsgenie.com (US)
// or https://api.eu.opsgenie.com (EU). The adapter exposes a `metadataKey`
// override so a DataSource can pin baseUrl per-account without forking. The
// US host is the documented default.
//   https://docs.opsgenie.com/docs/api-overview
//
// Wire format: Opsgenie returns JSON responses wrapped in
//   { data, took, requestId }
// envelopes for read calls and accepts plain JSON bodies on writes; no
// vendor Accept header is required.
//
// Scopes: Opsgenie defines per-resource read/write scopes documented at
//   https://docs.opsgenie.com/docs/oauth#scopes
// We request the read+write surface for alerts and incidents (the two
// primary mutation surfaces) plus read on schedules / on-call / teams /
// users so the adapter covers the documented triage + routing workflow.
// Consumers can narrow at grant time.
export const opsgenieConnector = declarativeRestConnector({
  kind: 'opsgenie',
  displayName: 'Opsgenie',
  description:
    'Create, acknowledge, and close Opsgenie alerts and incidents, attach notes, and read schedules, on-call assignments, teams, and users against a connected Opsgenie account.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.opsgenie.com/oauth/authorize',
    tokenUrl: 'https://app.opsgenie.com/oauth/token',
    scopes: [
      'alert.read',
      'alert.write',
      'incident.read',
      'incident.write',
      'schedule.read',
      'oncall.read',
      'team.read',
      'user.read',
    ],
    clientIdEnv: 'OPSGENIE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'OPSGENIE_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  // Default to the US REST host; EU-rooted accounts override
  // metadata.apiBaseUrl to https://api.eu.opsgenie.com.
  baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://api.opsgenie.com' },
  defaultHeaders: {
    accept: 'application/json',
    'content-type': 'application/json',
  },
  // /v2/account returns the workspace the token authenticates against; it is
  // the documented connectivity probe (Opsgenie does not expose a /me
  // endpoint for OAuth tokens).
  test: { method: 'GET', path: '/v2/account' },
  capabilities: [
    {
      name: 'alerts.list',
      class: 'read',
      description:
        'List Opsgenie alerts, optionally filtered by a search query (Opsgenie query DSL), with cursor-style offset pagination.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Opsgenie alert search expression, e.g. "status: open AND priority: P1".',
          },
          searchIdentifier: {
            type: 'string',
            description: 'Saved search id or name to reuse server-side.',
          },
          searchIdentifierType: {
            type: 'string',
            enum: ['id', 'name'],
            description: 'How searchIdentifier should be resolved.',
          },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          sort: {
            type: 'string',
            description:
              'Sort key, e.g. "createdAt", "updatedAt", "tinyId", "priority".',
          },
          order: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/alerts',
        query: {
          query: '{query}',
          searchIdentifier: '{searchIdentifier}',
          searchIdentifierType: '{searchIdentifierType}',
          offset: '{offset}',
          limit: '{limit}',
          sort: '{sort}',
          order: '{order}',
        },
      },
      requiredScopes: ['alert.read'],
    },
    {
      name: 'alerts.get',
      class: 'read',
      description:
        'Read a single alert by id, tiny id, or alias. `identifierType` defaults to "id" if omitted.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'tiny', 'alias'] },
        },
        required: ['identifier'],
      },
      request: {
        method: 'GET',
        path: '/v2/alerts/{identifier}',
        query: { identifierType: '{identifierType}' },
      },
      requiredScopes: ['alert.read'],
    },
    {
      name: 'alerts.create',
      class: 'mutation',
      description:
        'Create an Opsgenie alert. `message` is required; `responders`, `tags`, `priority`, and `alias` route and de-duplicate.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Alert title (max 130 chars).' },
          alias: {
            type: 'string',
            description: 'Client-side dedup key; subsequent creates with the same alias are merged.',
          },
          description: { type: 'string' },
          responders: {
            type: 'array',
            description: 'Routing targets; each entry references a team / user / schedule / escalation.',
            items: { type: 'object' },
          },
          visibleTo: {
            type: 'array',
            description: 'Optional team / user list that restricts who can see the alert.',
            items: { type: 'object' },
          },
          actions: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          details: {
            type: 'object',
            description: 'Free-form key/value metadata attached to the alert.',
          },
          entity: { type: 'string', description: 'Source entity that raised the alert.' },
          source: { type: 'string' },
          priority: {
            type: 'string',
            enum: ['P1', 'P2', 'P3', 'P4', 'P5'],
          },
          user: { type: 'string', description: 'Display name of the request actor.' },
          note: { type: 'string' },
        },
        required: ['message'],
      },
      request: {
        method: 'POST',
        path: '/v2/alerts',
        body: {
          message: '{message}',
          alias: '{alias}',
          description: '{description}',
          responders: '{responders}',
          visibleTo: '{visibleTo}',
          actions: '{actions}',
          tags: '{tags}',
          details: '{details}',
          entity: '{entity}',
          source: '{source}',
          priority: '{priority}',
          user: '{user}',
          note: '{note}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['alert.write'],
    },
    {
      name: 'alerts.acknowledge',
      class: 'mutation',
      description:
        'Acknowledge an alert. The alert is identified by id, tiny id, or alias.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'tiny', 'alias'] },
          user: { type: 'string' },
          source: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['identifier'],
      },
      request: {
        method: 'POST',
        path: '/v2/alerts/{identifier}/acknowledge',
        query: { identifierType: '{identifierType}' },
        body: { user: '{user}', source: '{source}', note: '{note}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['alert.write'],
    },
    {
      name: 'alerts.close',
      class: 'mutation',
      description: 'Close an alert.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'tiny', 'alias'] },
          user: { type: 'string' },
          source: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['identifier'],
      },
      request: {
        method: 'POST',
        path: '/v2/alerts/{identifier}/close',
        query: { identifierType: '{identifierType}' },
        body: { user: '{user}', source: '{source}', note: '{note}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['alert.write'],
    },
    {
      name: 'alerts.notes.list',
      class: 'read',
      description: 'List notes attached to an alert.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'tiny', 'alias'] },
          offset: { type: 'string', description: 'Opaque pagination offset returned by a prior call.' },
          direction: { type: 'string', enum: ['next', 'prev'] },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          order: { type: 'string', enum: ['asc', 'desc'] },
        },
        required: ['identifier'],
      },
      request: {
        method: 'GET',
        path: '/v2/alerts/{identifier}/notes',
        query: {
          identifierType: '{identifierType}',
          offset: '{offset}',
          direction: '{direction}',
          limit: '{limit}',
          order: '{order}',
        },
      },
      requiredScopes: ['alert.read'],
    },
    {
      name: 'alerts.notes.add',
      class: 'mutation',
      description: 'Attach a note to an alert.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'tiny', 'alias'] },
          note: { type: 'string' },
          user: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['identifier', 'note'],
      },
      request: {
        method: 'POST',
        path: '/v2/alerts/{identifier}/notes',
        query: { identifierType: '{identifierType}' },
        body: { note: '{note}', user: '{user}', source: '{source}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['alert.write'],
    },
    {
      name: 'incidents.list',
      class: 'read',
      description:
        'List Opsgenie incidents using the documented incident query DSL with cursor-style offset pagination.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Incident search expression, e.g. "status: open AND priority: P1".',
          },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          sort: { type: 'string' },
          order: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/incidents',
        query: {
          query: '{query}',
          offset: '{offset}',
          limit: '{limit}',
          sort: '{sort}',
          order: '{order}',
        },
      },
      requiredScopes: ['incident.read'],
    },
    {
      name: 'incidents.get',
      class: 'read',
      description: 'Read a single incident by id or tiny id.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'tiny'] },
        },
        required: ['identifier'],
      },
      request: {
        method: 'GET',
        path: '/v1/incidents/{identifier}',
        query: { identifierType: '{identifierType}' },
      },
      requiredScopes: ['incident.read'],
    },
    {
      name: 'incidents.create',
      class: 'mutation',
      description:
        'Open an Opsgenie incident. `message` is required; `responders`, `priority`, and `serviceId` route the incident.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          description: { type: 'string' },
          responders: { type: 'array', items: { type: 'object' } },
          tags: { type: 'array', items: { type: 'string' } },
          details: { type: 'object' },
          priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5'] },
          note: { type: 'string' },
          serviceId: {
            type: 'string',
            description: 'Opsgenie service id the incident is opened on.',
          },
          statusPageEntry: {
            type: 'object',
            description: 'Optional status-page payload (title + detail) for customer-facing communication.',
          },
          notifyStakeholders: { type: 'boolean' },
          impactedServices: { type: 'array', items: { type: 'string' } },
        },
        required: ['message'],
      },
      request: {
        method: 'POST',
        path: '/v1/incidents/create',
        body: {
          message: '{message}',
          description: '{description}',
          responders: '{responders}',
          tags: '{tags}',
          details: '{details}',
          priority: '{priority}',
          note: '{note}',
          serviceId: '{serviceId}',
          statusPageEntry: '{statusPageEntry}',
          notifyStakeholders: '{notifyStakeholders}',
          impactedServices: '{impactedServices}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['incident.write'],
    },
    {
      name: 'incidents.close',
      class: 'mutation',
      description: 'Resolve / close an Opsgenie incident.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'tiny'] },
          note: { type: 'string' },
        },
        required: ['identifier'],
      },
      request: {
        method: 'POST',
        path: '/v1/incidents/{identifier}/close',
        query: { identifierType: '{identifierType}' },
        body: { note: '{note}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['incident.write'],
    },
    {
      name: 'incidents.notes.add',
      class: 'mutation',
      description: 'Attach a note to an incident.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'tiny'] },
          note: { type: 'string' },
        },
        required: ['identifier', 'note'],
      },
      request: {
        method: 'POST',
        path: '/v1/incidents/{identifier}/notes',
        query: { identifierType: '{identifierType}' },
        body: { note: '{note}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['incident.write'],
    },
    {
      name: 'schedules.list',
      class: 'read',
      description: 'List on-call schedules with offset pagination.',
      parameters: {
        type: 'object',
        properties: {
          expand: {
            type: 'array',
            description: 'Optional expansion fields, e.g. "rotation".',
            items: { type: 'string' },
          },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/schedules',
        query: { expand: '{expand}' },
      },
      requiredScopes: ['schedule.read'],
    },
    {
      name: 'schedules.get',
      class: 'read',
      description: 'Read a single schedule by id or name.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'name'] },
        },
        required: ['identifier'],
      },
      request: {
        method: 'GET',
        path: '/v2/schedules/{identifier}',
        query: { identifierType: '{identifierType}' },
      },
      requiredScopes: ['schedule.read'],
    },
    {
      name: 'schedules.timeline',
      class: 'read',
      description:
        'Read the rendered timeline for a schedule between `interval` units relative to `date`.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'name'] },
          intervalUnit: { type: 'string', enum: ['days', 'weeks', 'months'] },
          interval: { type: 'integer', minimum: 1 },
          date: {
            type: 'string',
            description: 'ISO-8601 anchor date; defaults to now if omitted.',
          },
          expand: { type: 'array', items: { type: 'string' } },
        },
        required: ['identifier'],
      },
      request: {
        method: 'GET',
        path: '/v2/schedules/{identifier}/timeline',
        query: {
          identifierType: '{identifierType}',
          intervalUnit: '{intervalUnit}',
          interval: '{interval}',
          date: '{date}',
          expand: '{expand}',
        },
      },
      requiredScopes: ['schedule.read'],
    },
    {
      name: 'oncalls.current',
      class: 'read',
      description:
        'Return the current on-call participants for a schedule, optionally flattening nested escalations.',
      parameters: {
        type: 'object',
        properties: {
          scheduleIdentifier: { type: 'string' },
          scheduleIdentifierType: { type: 'string', enum: ['id', 'name'] },
          flat: { type: 'boolean', description: 'If true, returns only the flat list of users.' },
          date: { type: 'string', description: 'ISO-8601 timestamp for the query.' },
        },
        required: ['scheduleIdentifier'],
      },
      request: {
        method: 'GET',
        path: '/v2/schedules/{scheduleIdentifier}/on-calls',
        query: {
          scheduleIdentifierType: '{scheduleIdentifierType}',
          flat: '{flat}',
          date: '{date}',
        },
      },
      requiredScopes: ['oncall.read'],
    },
    {
      name: 'oncalls.next',
      class: 'read',
      description: 'Return the next on-call rotation for a schedule starting at `date` (or now).',
      parameters: {
        type: 'object',
        properties: {
          scheduleIdentifier: { type: 'string' },
          scheduleIdentifierType: { type: 'string', enum: ['id', 'name'] },
          flat: { type: 'boolean' },
          date: { type: 'string' },
        },
        required: ['scheduleIdentifier'],
      },
      request: {
        method: 'GET',
        path: '/v2/schedules/{scheduleIdentifier}/next-on-calls',
        query: {
          scheduleIdentifierType: '{scheduleIdentifierType}',
          flat: '{flat}',
          date: '{date}',
        },
      },
      requiredScopes: ['oncall.read'],
    },
    {
      name: 'teams.list',
      class: 'read',
      description: 'List all teams in the Opsgenie workspace.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v2/teams' },
      requiredScopes: ['team.read'],
    },
    {
      name: 'teams.get',
      class: 'read',
      description: 'Read a single team by id or name.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          identifierType: { type: 'string', enum: ['id', 'name'] },
        },
        required: ['identifier'],
      },
      request: {
        method: 'GET',
        path: '/v2/teams/{identifier}',
        query: { identifierType: '{identifierType}' },
      },
      requiredScopes: ['team.read'],
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'List Opsgenie users with offset pagination and an optional search query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search expression matched against user fields.' },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          sort: { type: 'string' },
          order: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/users',
        query: {
          query: '{query}',
          offset: '{offset}',
          limit: '{limit}',
          sort: '{sort}',
          order: '{order}',
        },
      },
      requiredScopes: ['user.read'],
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Read a single user by id or username.',
      parameters: {
        type: 'object',
        properties: {
          identifier: { type: 'string' },
          expand: { type: 'array', items: { type: 'string' } },
        },
        required: ['identifier'],
      },
      request: {
        method: 'GET',
        path: '/v2/users/{identifier}',
        query: { expand: '{expand}' },
      },
      requiredScopes: ['user.read'],
    },
  ],
})
