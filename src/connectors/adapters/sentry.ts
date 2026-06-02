import { declarativeRestConnector } from './declarative-rest.js'

// Sentry SaaS OAuth2 surface. The authorization endpoint is documented at
//   https://docs.sentry.io/api/auth/
//   https://docs.sentry.io/product/integrations/integration-platform/public-integration/
// for public integrations: the user installs the integration onto an
// organization, the install flow redirects to /sentry/install with a code,
// and the consumer exchanges the code at /oauth/token/.
//
// API routing: every authenticated call is rooted at https://sentry.io/api/0/.
// Self-hosted Sentry installs run the same API at a custom host; we expose a
// `metadataKey` fallback so a DataSource can override `baseUrl` to
// e.g. https://sentry.acme-corp.internal/api/0 without forking the adapter.
//
// Scopes are taken from the Sentry public integration documentation:
//   https://docs.sentry.io/product/integrations/integration-platform/public-integration/#permissions
// We request the read+write scopes needed to drive the issue / event /
// release surface this adapter exposes; consumers can narrow at grant time.
export const sentryConnector = declarativeRestConnector({
  kind: 'sentry',
  displayName: 'Sentry',
  description:
    'Triage Sentry issues, inspect events, list projects, and cut releases against a connected Sentry organization.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://sentry.io/oauth/authorize/',
    tokenUrl: 'https://sentry.io/oauth/token/',
    scopes: [
      'org:read',
      'project:read',
      'project:write',
      'project:releases',
      'team:read',
      'event:read',
      'event:write',
      'event:admin',
      'member:read',
    ],
    clientIdEnv: 'SENTRY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SENTRY_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  // Default to sentry.io SaaS; consumers running self-hosted Sentry override
  // by setting metadata.apiBaseUrl on the DataSource (e.g.
  // https://sentry.acme.internal/api/0).
  baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://sentry.io/api/0' },
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'organizations.list',
      class: 'read',
      description: 'List Sentry organizations the authenticated identity belongs to.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string', description: 'Pagination cursor returned by a prior call.' },
        },
      },
      request: {
        method: 'GET',
        path: '/organizations/',
        query: { cursor: '{cursor}' },
      },
      requiredScopes: ['org:read'],
    },
    {
      name: 'projects.list',
      class: 'read',
      description: 'List projects inside a Sentry organization.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string', description: 'Organization slug, e.g. "acme".' },
          cursor: { type: 'string' },
        },
        required: ['organizationSlug'],
      },
      request: {
        method: 'GET',
        path: '/organizations/{organizationSlug}/projects/',
        query: { cursor: '{cursor}' },
      },
      requiredScopes: ['project:read'],
    },
    {
      name: 'projects.get',
      class: 'read',
      description: 'Read a single project by organization slug and project slug.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          projectSlug: { type: 'string' },
        },
        required: ['organizationSlug', 'projectSlug'],
      },
      request: {
        method: 'GET',
        path: '/projects/{organizationSlug}/{projectSlug}/',
      },
      requiredScopes: ['project:read'],
    },
    {
      name: 'teams.list',
      class: 'read',
      description: 'List teams inside a Sentry organization.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          cursor: { type: 'string' },
        },
        required: ['organizationSlug'],
      },
      request: {
        method: 'GET',
        path: '/organizations/{organizationSlug}/teams/',
        query: { cursor: '{cursor}' },
      },
      requiredScopes: ['team:read'],
    },
    {
      name: 'issues.search',
      class: 'read',
      description:
        'Run an organization-wide issue search. Use Sentry search syntax in `query`, e.g. `is:unresolved level:error project:web`.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          query: {
            type: 'string',
            description: 'Sentry search query string (https://docs.sentry.io/concepts/search/).',
          },
          statsPeriod: {
            type: 'string',
            description: 'Relative time window, e.g. "24h", "14d", "90d". Mutually exclusive with start/end.',
          },
          start: { type: 'string', description: 'ISO-8601 start of an absolute window.' },
          end: { type: 'string', description: 'ISO-8601 end of an absolute window.' },
          environment: { type: 'string' },
          project: { type: 'string', description: 'Project id; pass multiple as a comma-separated list.' },
          sort: { type: 'string', enum: ['date', 'new', 'priority', 'freq', 'user'] },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string' },
        },
        required: ['organizationSlug'],
      },
      request: {
        method: 'GET',
        path: '/organizations/{organizationSlug}/issues/',
        query: {
          query: '{query}',
          statsPeriod: '{statsPeriod}',
          start: '{start}',
          end: '{end}',
          environment: '{environment}',
          project: '{project}',
          sort: '{sort}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
      requiredScopes: ['event:read'],
    },
    {
      name: 'issues.get',
      class: 'read',
      description: 'Read a single Sentry issue by numeric issue id.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string', description: 'Numeric issue id (group id), e.g. "1234567890".' },
        },
        required: ['issueId'],
      },
      request: {
        method: 'GET',
        path: '/issues/{issueId}/',
      },
      requiredScopes: ['event:read'],
    },
    {
      name: 'issues.update',
      class: 'mutation',
      description:
        'Mutate triage state on a Sentry issue: resolve / unresolve / ignore / assign / star / mark seen.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          fields: {
            type: 'object',
            description:
              'Issue update payload. Supports `status` ("resolved" | "resolvedInNextRelease" | "unresolved" | "ignored"), `statusDetails`, `assignedTo` (username, team:slug, or null), `hasSeen`, `isBookmarked`, `isSubscribed`, `isPublic`.',
            properties: {
              status: {
                type: 'string',
                enum: ['resolved', 'resolvedInNextRelease', 'unresolved', 'ignored'],
              },
              statusDetails: { type: 'object' },
              assignedTo: { type: ['string', 'null'] },
              hasSeen: { type: 'boolean' },
              isBookmarked: { type: 'boolean' },
              isSubscribed: { type: 'boolean' },
              isPublic: { type: 'boolean' },
            },
          },
        },
        required: ['issueId', 'fields'],
      },
      request: {
        method: 'PUT',
        path: '/issues/{issueId}/',
        body: '{fields}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['event:write'],
    },
    {
      name: 'issues.delete',
      class: 'mutation',
      description: 'Permanently delete a Sentry issue (group). Use with caution.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
        },
        required: ['issueId'],
      },
      request: {
        method: 'DELETE',
        path: '/issues/{issueId}/',
      },
      cas: 'native-idempotency',
      requiredScopes: ['event:admin'],
    },
    {
      name: 'issues.events.list',
      class: 'read',
      description: 'List recent events attached to a Sentry issue (group).',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          environment: { type: 'string' },
          cursor: { type: 'string' },
        },
        required: ['issueId'],
      },
      request: {
        method: 'GET',
        path: '/issues/{issueId}/events/',
        query: { environment: '{environment}', cursor: '{cursor}' },
      },
      requiredScopes: ['event:read'],
    },
    {
      name: 'issues.events.latest',
      class: 'read',
      description: 'Return the latest event for a Sentry issue (group), including stack trace and tags.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
        },
        required: ['issueId'],
      },
      request: {
        method: 'GET',
        path: '/issues/{issueId}/events/latest/',
      },
      requiredScopes: ['event:read'],
    },
    {
      name: 'issues.comments.list',
      class: 'read',
      description: 'List comments (notes) on a Sentry issue.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          cursor: { type: 'string' },
        },
        required: ['issueId'],
      },
      request: {
        method: 'GET',
        path: '/issues/{issueId}/comments/',
        query: { cursor: '{cursor}' },
      },
      requiredScopes: ['event:read'],
    },
    {
      name: 'issues.comments.create',
      class: 'mutation',
      description: 'Post a note (comment) on a Sentry issue.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          text: { type: 'string', description: 'Markdown body of the note.' },
          mentions: {
            type: 'array',
            description: 'Optional list of @-mentions: usernames or team:slug entries.',
            items: { type: 'string' },
          },
        },
        required: ['issueId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/issues/{issueId}/comments/',
        body: { text: '{text}', mentions: '{mentions}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['event:write'],
    },
    {
      name: 'events.get',
      class: 'read',
      description: 'Read a single event by project and event id, including full stack trace, tags, and context.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          projectSlug: { type: 'string' },
          eventId: { type: 'string', description: '32-char Sentry event id (hex).' },
        },
        required: ['organizationSlug', 'projectSlug', 'eventId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{organizationSlug}/{projectSlug}/events/{eventId}/',
      },
      requiredScopes: ['event:read'],
    },
    {
      name: 'releases.list',
      class: 'read',
      description: 'List releases for a Sentry organization.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          query: { type: 'string', description: 'Filter by release version substring.' },
          project: { type: 'string', description: 'Project id; comma-separated to scope to specific projects.' },
          cursor: { type: 'string' },
        },
        required: ['organizationSlug'],
      },
      request: {
        method: 'GET',
        path: '/organizations/{organizationSlug}/releases/',
        query: { query: '{query}', project: '{project}', cursor: '{cursor}' },
      },
      requiredScopes: ['project:releases'],
    },
    {
      name: 'releases.get',
      class: 'read',
      description: 'Read a single release by version.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['organizationSlug', 'version'],
      },
      request: {
        method: 'GET',
        path: '/organizations/{organizationSlug}/releases/{version}/',
      },
      requiredScopes: ['project:releases'],
    },
    {
      name: 'releases.create',
      class: 'mutation',
      description:
        'Create a Sentry release. `projects` is required and lists project slugs the release applies to; `refs` and `commits` are optional commit-tracking inputs.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          fields: {
            type: 'object',
            properties: {
              version: { type: 'string' },
              projects: { type: 'array', items: { type: 'string' } },
              ref: { type: 'string' },
              url: { type: 'string' },
              dateReleased: { type: 'string', description: 'ISO-8601 timestamp.' },
              refs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    repository: { type: 'string' },
                    commit: { type: 'string' },
                    previousCommit: { type: 'string' },
                  },
                  required: ['repository', 'commit'],
                },
              },
              commits: {
                type: 'array',
                items: { type: 'object' },
              },
            },
            required: ['version', 'projects'],
          },
        },
        required: ['organizationSlug', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/organizations/{organizationSlug}/releases/',
        body: '{fields}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['project:releases'],
    },
    {
      name: 'releases.update',
      class: 'mutation',
      description: 'Update fields on a Sentry release (e.g. dateReleased, ref, url).',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          version: { type: 'string' },
          fields: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              url: { type: 'string' },
              dateReleased: { type: 'string' },
              commits: { type: 'array', items: { type: 'object' } },
              refs: { type: 'array', items: { type: 'object' } },
            },
          },
        },
        required: ['organizationSlug', 'version', 'fields'],
      },
      request: {
        method: 'PUT',
        path: '/organizations/{organizationSlug}/releases/{version}/',
        body: '{fields}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['project:releases'],
    },
    {
      name: 'releases.delete',
      class: 'mutation',
      description: 'Delete a Sentry release. Fails if the release still has associated events.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['organizationSlug', 'version'],
      },
      request: {
        method: 'DELETE',
        path: '/organizations/{organizationSlug}/releases/{version}/',
      },
      cas: 'native-idempotency',
      requiredScopes: ['project:releases'],
    },
    {
      name: 'issues.resolve',
      class: 'mutation',
      description:
        'Resolve a Sentry issue. For conditional resolution ("inNextRelease", "inRelease", "inCommit"), use `issues.update` and pass `statusDetails` explicitly.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
        },
        required: ['issueId'],
      },
      request: {
        method: 'PUT',
        path: '/issues/{issueId}/',
        body: { status: 'resolved' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['event:write'],
    },
    {
      name: 'issues.ignore',
      class: 'mutation',
      description:
        'Ignore a Sentry issue. For duration- or count-based ignore (`ignoreDuration`, `ignoreCount`, `ignoreUserCount`, `ignoreWindow`, `ignoreUserWindow`), use `issues.update` with `statusDetails` instead.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
        },
        required: ['issueId'],
      },
      request: {
        method: 'PUT',
        path: '/issues/{issueId}/',
        body: { status: 'ignored' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['event:write'],
    },
    {
      name: 'issues.assign',
      class: 'mutation',
      description:
        'Assign a Sentry issue to a user or team. `assignedTo` accepts a username for users or `team:<slug>` for teams. To unassign, call `issues.update` with `assignedTo: null`.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          assignedTo: {
            type: 'string',
            description: 'Username or "team:<slug>". Use issues.update to unassign.',
          },
        },
        required: ['issueId', 'assignedTo'],
      },
      request: {
        method: 'PUT',
        path: '/issues/{issueId}/',
        body: { assignedTo: '{assignedTo}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['event:write'],
    },
    {
      name: 'alerts.list',
      class: 'read',
      description: 'List alert rules (issue alerts) configured on a Sentry project.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          projectSlug: { type: 'string' },
          cursor: { type: 'string' },
        },
        required: ['organizationSlug', 'projectSlug'],
      },
      request: {
        method: 'GET',
        path: '/projects/{organizationSlug}/{projectSlug}/rules/',
        query: { cursor: '{cursor}' },
      },
      requiredScopes: ['project:read'],
    },
    {
      name: 'alerts.create',
      class: 'mutation',
      description:
        'Create a new issue alert rule on a Sentry project. `fields` must include `name`, `conditions`, `actions`, `actionMatch`, and `frequency` per the Sentry alert rule schema.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          projectSlug: { type: 'string' },
          fields: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              conditions: { type: 'array', items: { type: 'object' } },
              filters: { type: 'array', items: { type: 'object' } },
              actions: { type: 'array', items: { type: 'object' } },
              actionMatch: { type: 'string', enum: ['all', 'any', 'none'] },
              filterMatch: { type: 'string', enum: ['all', 'any', 'none'] },
              frequency: { type: 'integer', description: 'Cooldown in minutes between alert firings.' },
              environment: { type: 'string' },
              owner: { type: 'string', description: 'Owner actor id, e.g. "user:<id>" or "team:<id>".' },
            },
            required: ['name', 'conditions', 'actions', 'actionMatch', 'frequency'],
          },
        },
        required: ['organizationSlug', 'projectSlug', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/projects/{organizationSlug}/{projectSlug}/rules/',
        body: '{fields}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['project:write'],
    },
    {
      name: 'releases.deploys.create',
      class: 'mutation',
      description: 'Record a deploy of a Sentry release into an environment.',
      parameters: {
        type: 'object',
        properties: {
          organizationSlug: { type: 'string' },
          version: { type: 'string' },
          fields: {
            type: 'object',
            properties: {
              environment: { type: 'string' },
              name: { type: 'string' },
              url: { type: 'string' },
              dateStarted: { type: 'string' },
              dateFinished: { type: 'string' },
              projects: { type: 'array', items: { type: 'string' } },
            },
            required: ['environment'],
          },
        },
        required: ['organizationSlug', 'version', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/organizations/{organizationSlug}/releases/{version}/deploys/',
        body: '{fields}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['project:releases'],
    },
  ],
})
