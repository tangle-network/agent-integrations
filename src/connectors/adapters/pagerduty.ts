import { declarativeRestConnector } from './declarative-rest.js'

// PagerDuty OAuth2 surface. The user-flow authorization endpoint and token
// endpoint are documented at
//   https://developer.pagerduty.com/docs/oauth-2-functionality
//   https://developer.pagerduty.com/docs/app-types#oauth-2
// PagerDuty exposes a single global identity host
// (https://identity.pagerduty.com) for the user-authorization code+exchange
// dance regardless of which region the account is rooted in.
//
// API routing: every authenticated REST call lands on
// https://api.pagerduty.com (US) or https://api.eu.pagerduty.com (EU). We
// expose a `metadataKey` fallback so a DataSource can override `baseUrl` for
// EU-region accounts without forking the adapter.
//
// Wire format: PagerDuty requires
//   Accept: application/vnd.pagerduty+json;version=2
// on every REST call (the v2 envelope is the only supported version). The
// declarative-rest harness layers this through `defaultHeaders`.
//
// Scopes come from
//   https://developer.pagerduty.com/docs/oauth-scopes
// We request the read+write scopes needed to drive the incident / service /
// escalation-policy surface this adapter exposes; consumers can narrow at
// grant time.
export const pagerdutyConnector = declarativeRestConnector({
  kind: 'pagerduty',
  displayName: 'PagerDuty',
  description:
    'Triage PagerDuty incidents, page on-call responders, mutate services and escalation policies, and read schedules against a connected PagerDuty account.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://identity.pagerduty.com/oauth/authorize',
    tokenUrl: 'https://identity.pagerduty.com/oauth/token',
    scopes: [
      'incidents.read',
      'incidents.write',
      'services.read',
      'services.write',
      'escalation_policies.read',
      'escalation_policies.write',
      'schedules.read',
      'schedules.write',
      'teams.read',
      'users.read',
      'oncalls.read',
    ],
    clientIdEnv: 'PAGERDUTY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'PAGERDUTY_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  // Default to the US REST host; EU-rooted accounts override
  // metadata.apiBaseUrl to https://api.eu.pagerduty.com.
  baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://api.pagerduty.com' },
  defaultHeaders: {
    // PagerDuty pins API version through the Accept header; omitting it falls
    // back to a legacy contract we do not target.
    accept: 'application/vnd.pagerduty+json;version=2',
  },
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'incidents.list',
      class: 'read',
      description:
        'List incidents, optionally filtered by status, service, urgency, time window, or assigned user.',
      parameters: {
        type: 'object',
        properties: {
          statuses: {
            type: 'array',
            description: 'Filter by incident status. Repeat to match multiple values.',
            items: { type: 'string', enum: ['triggered', 'acknowledged', 'resolved'] },
          },
          serviceIds: {
            type: 'array',
            description: 'PagerDuty service ids to scope the search to.',
            items: { type: 'string' },
          },
          userIds: {
            type: 'array',
            description: 'Filter to incidents assigned to the given user ids.',
            items: { type: 'string' },
          },
          urgencies: {
            type: 'array',
            description: 'Filter by urgency.',
            items: { type: 'string', enum: ['high', 'low'] },
          },
          since: { type: 'string', description: 'ISO-8601 lower bound on created_at.' },
          until: { type: 'string', description: 'ISO-8601 upper bound on created_at.' },
          sortBy: {
            type: 'string',
            description: 'Sort key, e.g. "created_at:desc" or "urgency:asc".',
          },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/incidents',
        query: {
          'statuses[]': '{statuses}',
          'service_ids[]': '{serviceIds}',
          'user_ids[]': '{userIds}',
          'urgencies[]': '{urgencies}',
          since: '{since}',
          until: '{until}',
          sort_by: '{sortBy}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['incidents.read'],
    },
    {
      name: 'incidents.get',
      class: 'read',
      description: 'Read a single incident by id.',
      parameters: {
        type: 'object',
        properties: {
          incidentId: { type: 'string' },
        },
        required: ['incidentId'],
      },
      request: { method: 'GET', path: '/incidents/{incidentId}' },
      requiredScopes: ['incidents.read'],
    },
    {
      name: 'incidents.create',
      class: 'mutation',
      description:
        'Create a PagerDuty incident on a service. Requires a From email (the user the call acts as).',
      parameters: {
        type: 'object',
        properties: {
          fromEmail: {
            type: 'string',
            description:
              'Email of the PagerDuty user the incident is created as; supplied as the From request header.',
          },
          incident: {
            type: 'object',
            description:
              'Incident payload. Must include `type: "incident"`, a `title`, and a `service` reference of shape { id, type: "service_reference" }.',
            properties: {
              type: { type: 'string', enum: ['incident'] },
              title: { type: 'string' },
              service: { type: 'object' },
              urgency: { type: 'string', enum: ['high', 'low'] },
              body: { type: 'object' },
              incident_key: { type: 'string', description: 'Dedup key for the incident.' },
              priority: { type: 'object' },
              escalation_policy: { type: 'object' },
              assignments: { type: 'array', items: { type: 'object' } },
              conference_bridge: { type: 'object' },
            },
            required: ['type', 'title', 'service'],
          },
        },
        required: ['fromEmail', 'incident'],
      },
      request: {
        method: 'POST',
        path: '/incidents',
        headers: { from: '{fromEmail}' },
        body: { incident: '{incident}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['incidents.write'],
    },
    {
      name: 'incidents.update',
      class: 'mutation',
      description:
        'Update a PagerDuty incident: change status, escalate, snooze, reassign, or set priority. Requires a From email.',
      parameters: {
        type: 'object',
        properties: {
          incidentId: { type: 'string' },
          fromEmail: { type: 'string' },
          incident: {
            type: 'object',
            description:
              'Incident patch payload. Supports `status` ("acknowledged" | "resolved"), `priority`, `assignments`, `escalation_level`, `resolution`, `title`, `urgency`.',
            properties: {
              type: { type: 'string', enum: ['incident_reference'] },
              status: { type: 'string', enum: ['acknowledged', 'resolved'] },
              resolution: { type: 'string' },
              title: { type: 'string' },
              urgency: { type: 'string', enum: ['high', 'low'] },
              escalation_level: { type: 'integer', minimum: 1 },
              priority: { type: 'object' },
              assignments: { type: 'array', items: { type: 'object' } },
            },
          },
        },
        required: ['incidentId', 'fromEmail', 'incident'],
      },
      request: {
        method: 'PUT',
        path: '/incidents/{incidentId}',
        headers: { from: '{fromEmail}' },
        body: { incident: '{incident}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['incidents.write'],
    },
    {
      name: 'incidents.notes.list',
      class: 'read',
      description: 'List notes (comments) on an incident.',
      parameters: {
        type: 'object',
        properties: { incidentId: { type: 'string' } },
        required: ['incidentId'],
      },
      request: { method: 'GET', path: '/incidents/{incidentId}/notes' },
      requiredScopes: ['incidents.read'],
    },
    {
      name: 'incidents.notes.create',
      class: 'mutation',
      description: 'Add a note to an incident. Requires a From email.',
      parameters: {
        type: 'object',
        properties: {
          incidentId: { type: 'string' },
          fromEmail: { type: 'string' },
          content: { type: 'string', description: 'Note body.' },
        },
        required: ['incidentId', 'fromEmail', 'content'],
      },
      request: {
        method: 'POST',
        path: '/incidents/{incidentId}/notes',
        headers: { from: '{fromEmail}' },
        body: { note: { content: '{content}' } },
      },
      cas: 'native-idempotency',
      requiredScopes: ['incidents.write'],
    },
    {
      name: 'incidents.snooze',
      class: 'mutation',
      description: 'Snooze an incident for a given duration in seconds. Requires a From email.',
      parameters: {
        type: 'object',
        properties: {
          incidentId: { type: 'string' },
          fromEmail: { type: 'string' },
          duration: {
            type: 'integer',
            minimum: 1,
            description: 'Seconds to snooze; PagerDuty caps this at 24 hours.',
          },
        },
        required: ['incidentId', 'fromEmail', 'duration'],
      },
      request: {
        method: 'POST',
        path: '/incidents/{incidentId}/snooze',
        headers: { from: '{fromEmail}' },
        body: { duration: '{duration}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['incidents.write'],
    },
    {
      name: 'services.list',
      class: 'read',
      description: 'List services, optionally filtered by team or name query.',
      parameters: {
        type: 'object',
        properties: {
          teamIds: { type: 'array', items: { type: 'string' } },
          query: { type: 'string', description: 'Substring match on service name.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/services',
        query: {
          'team_ids[]': '{teamIds}',
          query: '{query}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['services.read'],
    },
    {
      name: 'services.get',
      class: 'read',
      description: 'Read a single service by id.',
      parameters: {
        type: 'object',
        properties: { serviceId: { type: 'string' } },
        required: ['serviceId'],
      },
      request: { method: 'GET', path: '/services/{serviceId}' },
      requiredScopes: ['services.read'],
    },
    {
      name: 'services.create',
      class: 'mutation',
      description:
        'Create a PagerDuty service. The payload must include `type: "service"`, `name`, and an `escalation_policy` reference.',
      parameters: {
        type: 'object',
        properties: {
          service: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['service'] },
              name: { type: 'string' },
              description: { type: 'string' },
              auto_resolve_timeout: { type: ['integer', 'null'] },
              acknowledgement_timeout: { type: ['integer', 'null'] },
              escalation_policy: { type: 'object' },
              alert_creation: {
                type: 'string',
                enum: ['create_alerts_and_incidents', 'create_incidents'],
              },
              incident_urgency_rule: { type: 'object' },
              support_hours: { type: 'object' },
              scheduled_actions: { type: 'array', items: { type: 'object' } },
            },
            required: ['type', 'name', 'escalation_policy'],
          },
        },
        required: ['service'],
      },
      request: {
        method: 'POST',
        path: '/services',
        body: { service: '{service}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['services.write'],
    },
    {
      name: 'services.update',
      class: 'mutation',
      description: 'Update fields on a PagerDuty service.',
      parameters: {
        type: 'object',
        properties: {
          serviceId: { type: 'string' },
          service: { type: 'object' },
        },
        required: ['serviceId', 'service'],
      },
      request: {
        method: 'PUT',
        path: '/services/{serviceId}',
        body: { service: '{service}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['services.write'],
    },
    {
      name: 'services.delete',
      class: 'mutation',
      description: 'Delete a PagerDuty service. Open incidents on the service must be resolved first.',
      parameters: {
        type: 'object',
        properties: { serviceId: { type: 'string' } },
        required: ['serviceId'],
      },
      request: { method: 'DELETE', path: '/services/{serviceId}' },
      cas: 'native-idempotency',
      requiredScopes: ['services.write'],
    },
    {
      name: 'escalation_policies.list',
      class: 'read',
      description: 'List escalation policies, optionally filtered by team or substring query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          teamIds: { type: 'array', items: { type: 'string' } },
          userIds: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/escalation_policies',
        query: {
          query: '{query}',
          'team_ids[]': '{teamIds}',
          'user_ids[]': '{userIds}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['escalation_policies.read'],
    },
    {
      name: 'escalation_policies.get',
      class: 'read',
      description: 'Read a single escalation policy by id.',
      parameters: {
        type: 'object',
        properties: { escalationPolicyId: { type: 'string' } },
        required: ['escalationPolicyId'],
      },
      request: { method: 'GET', path: '/escalation_policies/{escalationPolicyId}' },
      requiredScopes: ['escalation_policies.read'],
    },
    {
      name: 'escalation_policies.create',
      class: 'mutation',
      description:
        'Create an escalation policy. Payload must include `type: "escalation_policy"`, `name`, and `escalation_rules`.',
      parameters: {
        type: 'object',
        properties: {
          escalation_policy: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['escalation_policy'] },
              name: { type: 'string' },
              escalation_rules: { type: 'array', items: { type: 'object' } },
              num_loops: { type: 'integer', minimum: 0 },
              on_call_handoff_notifications: { type: 'string', enum: ['if_has_services', 'always'] },
              teams: { type: 'array', items: { type: 'object' } },
              description: { type: 'string' },
            },
            required: ['type', 'name', 'escalation_rules'],
          },
        },
        required: ['escalation_policy'],
      },
      request: {
        method: 'POST',
        path: '/escalation_policies',
        body: { escalation_policy: '{escalation_policy}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['escalation_policies.write'],
    },
    {
      name: 'escalation_policies.update',
      class: 'mutation',
      description: 'Update an escalation policy.',
      parameters: {
        type: 'object',
        properties: {
          escalationPolicyId: { type: 'string' },
          escalation_policy: { type: 'object' },
        },
        required: ['escalationPolicyId', 'escalation_policy'],
      },
      request: {
        method: 'PUT',
        path: '/escalation_policies/{escalationPolicyId}',
        body: { escalation_policy: '{escalation_policy}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['escalation_policies.write'],
    },
    {
      name: 'schedules.list',
      class: 'read',
      description: 'List on-call schedules, optionally filtered by substring query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/schedules',
        query: { query: '{query}', limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['schedules.read'],
    },
    {
      name: 'schedules.get',
      class: 'read',
      description:
        'Read a schedule by id, optionally returning the rendered timeline between `since` and `until`.',
      parameters: {
        type: 'object',
        properties: {
          scheduleId: { type: 'string' },
          since: { type: 'string', description: 'ISO-8601 start of the rendered timeline.' },
          until: { type: 'string', description: 'ISO-8601 end of the rendered timeline.' },
          timeZone: { type: 'string', description: 'IANA tz used to render the schedule.' },
        },
        required: ['scheduleId'],
      },
      request: {
        method: 'GET',
        path: '/schedules/{scheduleId}',
        query: { since: '{since}', until: '{until}', time_zone: '{timeZone}' },
      },
      requiredScopes: ['schedules.read'],
    },
    {
      name: 'oncalls.list',
      class: 'read',
      description:
        'List on-call entries — who is currently or imminently on call for which escalation policy / level / time range.',
      parameters: {
        type: 'object',
        properties: {
          escalationPolicyIds: { type: 'array', items: { type: 'string' } },
          userIds: { type: 'array', items: { type: 'string' } },
          scheduleIds: { type: 'array', items: { type: 'string' } },
          since: { type: 'string', description: 'ISO-8601 lower bound.' },
          until: { type: 'string', description: 'ISO-8601 upper bound.' },
          earliest: {
            type: 'boolean',
            description: 'If true, return only the earliest active on-call per layer.',
          },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/oncalls',
        query: {
          'escalation_policy_ids[]': '{escalationPolicyIds}',
          'user_ids[]': '{userIds}',
          'schedule_ids[]': '{scheduleIds}',
          since: '{since}',
          until: '{until}',
          earliest: '{earliest}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['oncalls.read'],
    },
    {
      name: 'teams.list',
      class: 'read',
      description: 'List teams, optionally filtered by substring query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/teams',
        query: { query: '{query}', limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['teams.read'],
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'List PagerDuty users, optionally filtered by substring query or team.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          teamIds: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/users',
        query: {
          query: '{query}',
          'team_ids[]': '{teamIds}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['users.read'],
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Read a single user by id.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      request: { method: 'GET', path: '/users/{userId}' },
      requiredScopes: ['users.read'],
    },
    {
      name: 'users.me',
      class: 'read',
      description: 'Read the user the connected credential authenticates as.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/users/me' },
      requiredScopes: ['users.read'],
    },
  ],
})
