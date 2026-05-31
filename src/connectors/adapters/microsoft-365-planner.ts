import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft 365 Planner connector backed by Microsoft Graph v1.0.
 *
 * Auth: OAuth2 against the Entra ID v2.0 endpoint. Uses the `common` tenant so the
 * same app registration works for multi-tenant deployments; single-tenant operators
 * override authorizationUrl/tokenUrl with their own tenant id at construction time.
 *
 * Planner write operations (update + delete) require optimistic concurrency via the
 * `If-Match` header carrying the resource `@odata.etag`. The declarative-REST runtime
 * surfaces `cas: 'optimistic-read-verify'` and `cas: 'etag-if-match'` for callers that
 * need to thread the etag through; the etag itself is read from the prior GET.
 *
 * Docs:
 *   - https://learn.microsoft.com/graph/api/resources/planner-overview
 *   - https://learn.microsoft.com/graph/api/resources/plannertask
 *   - https://learn.microsoft.com/graph/api/resources/plannerbucket
 *   - https://learn.microsoft.com/graph/api/resources/plannerplan
 */
export const microsoft365PlannerConnector = declarativeRestConnector({
  kind: 'microsoft-365-planner',
  displayName: 'Microsoft 365 Planner',
  description:
    'Create, read, update, and delete Microsoft 365 Planner plans, buckets, and tasks via Microsoft Graph.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      'offline_access',
      'Tasks.ReadWrite',
      'Group.ReadWrite.All',
    ],
    clientIdEnv: 'MS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.microsoft.com/v1.0',
  // GET /me — cheap liveness probe against Graph that exercises the bearer token
  // without requiring Planner-specific data to exist on the account yet.
  test: { method: 'GET', path: '/me' },
  capabilities: [
    // ---------- Plans ----------
    {
      name: 'create.plan',
      class: 'mutation',
      description:
        'Create a new Planner plan owned by a Microsoft 365 group. The owner must be a group id with a Planner-enabled group container.',
      parameters: {
        type: 'object',
        properties: {
          owner: {
            type: 'string',
            description: 'Microsoft 365 group id that will own the plan.',
          },
          title: { type: 'string', description: 'Display title for the plan.' },
        },
        required: ['owner', 'title'],
      },
      request: {
        method: 'POST',
        path: '/planner/plans',
        body: { owner: '{owner}', title: '{title}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Tasks.ReadWrite', 'Group.ReadWrite.All'],
    },
    {
      name: 'find.aplan',
      class: 'read',
      description: 'Read a Planner plan by id.',
      parameters: {
        type: 'object',
        properties: { planId: { type: 'string' } },
        required: ['planId'],
      },
      request: { method: 'GET', path: '/planner/plans/{planId}' },
      requiredScopes: ['Tasks.ReadWrite'],
    },
    {
      name: 'update.plan',
      class: 'mutation',
      description:
        'Patch fields on a Planner plan. The caller must thread the resource @odata.etag through the If-Match header (handled by the optimistic-read-verify CAS path).',
      parameters: {
        type: 'object',
        properties: {
          planId: { type: 'string' },
          patch: {
            type: 'object',
            properties: { title: { type: 'string' } },
          },
        },
        required: ['planId', 'patch'],
      },
      request: {
        method: 'PATCH',
        path: '/planner/plans/{planId}',
        body: '{patch}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['Tasks.ReadWrite'],
    },

    // ---------- Buckets ----------
    {
      name: 'create.bucket',
      class: 'mutation',
      description:
        'Create a Planner bucket inside an existing plan. orderHint controls placement among siblings; omit to let Graph assign a default.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name for the bucket.' },
          planId: {
            type: 'string',
            description: 'Plan id this bucket belongs to.',
          },
          orderHint: {
            type: 'string',
            description:
              'Optional Planner orderHint string controlling placement among sibling buckets.',
          },
        },
        required: ['name', 'planId'],
      },
      request: {
        method: 'POST',
        path: '/planner/buckets',
        body: { name: '{name}', planId: '{planId}', orderHint: '{orderHint}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Tasks.ReadWrite'],
    },
    {
      name: 'get.abucket',
      class: 'read',
      description: 'Read a Planner bucket by id.',
      parameters: {
        type: 'object',
        properties: { bucketId: { type: 'string' } },
        required: ['bucketId'],
      },
      request: { method: 'GET', path: '/planner/buckets/{bucketId}' },
      requiredScopes: ['Tasks.ReadWrite'],
    },
    {
      name: 'update.bucket',
      class: 'mutation',
      description:
        'Patch fields on a Planner bucket. Requires the bucket @odata.etag in If-Match (optimistic-read-verify).',
      parameters: {
        type: 'object',
        properties: {
          bucketId: { type: 'string' },
          patch: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              orderHint: { type: 'string' },
            },
          },
        },
        required: ['bucketId', 'patch'],
      },
      request: {
        method: 'PATCH',
        path: '/planner/buckets/{bucketId}',
        body: '{patch}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['Tasks.ReadWrite'],
    },
    {
      name: 'delete.bucket',
      class: 'mutation',
      description:
        'Delete a Planner bucket. Requires the bucket @odata.etag in If-Match (etag-if-match).',
      parameters: {
        type: 'object',
        properties: { bucketId: { type: 'string' } },
        required: ['bucketId'],
      },
      request: { method: 'DELETE', path: '/planner/buckets/{bucketId}' },
      cas: 'etag-if-match',
      requiredScopes: ['Tasks.ReadWrite'],
    },

    // ---------- Tasks ----------
    {
      name: 'create.task',
      class: 'mutation',
      description:
        'Create a Planner task inside a plan (and optionally a specific bucket). assignments is a map keyed by user id whose value carries the assignment payload.',
      parameters: {
        type: 'object',
        properties: {
          planId: { type: 'string' },
          bucketId: { type: 'string' },
          title: { type: 'string' },
          assignments: {
            type: 'object',
            description:
              'Map of userId → { @odata.type: "microsoft.graph.plannerAssignment", orderHint }.',
          },
          dueDateTime: { type: 'string', description: 'ISO-8601 timestamp.' },
          startDateTime: { type: 'string', description: 'ISO-8601 timestamp.' },
          priority: {
            type: 'integer',
            minimum: 0,
            maximum: 10,
            description: 'Planner priority 0–10 (1=urgent, 3=important, 5=medium, 9=low).',
          },
          percentComplete: { type: 'integer', minimum: 0, maximum: 100 },
        },
        required: ['planId', 'title'],
      },
      request: {
        method: 'POST',
        path: '/planner/tasks',
        body: {
          planId: '{planId}',
          bucketId: '{bucketId}',
          title: '{title}',
          assignments: '{assignments}',
          dueDateTime: '{dueDateTime}',
          startDateTime: '{startDateTime}',
          priority: '{priority}',
          percentComplete: '{percentComplete}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Tasks.ReadWrite'],
    },
    {
      name: 'find.task',
      class: 'read',
      description: 'Read a Planner task by id.',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
      request: { method: 'GET', path: '/planner/tasks/{taskId}' },
      requiredScopes: ['Tasks.ReadWrite'],
    },
    {
      name: 'update.task',
      class: 'mutation',
      description:
        'Patch fields on a Planner task. Requires the task @odata.etag in If-Match (optimistic-read-verify).',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          patch: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              bucketId: { type: 'string' },
              assignments: { type: 'object' },
              dueDateTime: { type: 'string' },
              startDateTime: { type: 'string' },
              priority: { type: 'integer', minimum: 0, maximum: 10 },
              percentComplete: { type: 'integer', minimum: 0, maximum: 100 },
              orderHint: { type: 'string' },
              assigneePriority: { type: 'string' },
            },
          },
        },
        required: ['taskId', 'patch'],
      },
      request: {
        method: 'PATCH',
        path: '/planner/tasks/{taskId}',
        body: '{patch}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['Tasks.ReadWrite'],
    },
    {
      name: 'delete.task',
      class: 'mutation',
      description:
        'Delete a Planner task. Requires the task @odata.etag in If-Match (etag-if-match).',
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' } },
        required: ['taskId'],
      },
      request: { method: 'DELETE', path: '/planner/tasks/{taskId}' },
      cas: 'etag-if-match',
      requiredScopes: ['Tasks.ReadWrite'],
    },
  ],
})
