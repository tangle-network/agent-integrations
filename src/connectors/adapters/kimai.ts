import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Kimai is a self-hosted time-tracking application. Each tenant runs its
 * own instance, so the base URL is sourced from connection metadata
 * (`instanceUrl`, e.g. `https://demo.kimai.org`). API access uses the
 * legacy `X-AUTH-USER` / `X-AUTH-TOKEN` header pair documented in the
 * Kimai REST docs at `/api/doc`; the api-key credential carries the
 * token, and the username is supplied via metadata.
 */
export const kimaiConnector = declarativeRestConnector({
  kind: 'kimai',
  displayName: 'Kimai',
  description:
    'Record timesheet entries against the customer-hosted Kimai instance for time-tracking automation.',
  auth: {
    kind: 'api-key',
    hint: 'Kimai API password for the configured user. Sent as the X-AUTH-TOKEN header alongside the X-AUTH-USER username supplied via connection metadata.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instanceUrl' },
  test: { method: 'GET', path: '/api/ping' },
  capabilities: [
    {
      name: 'timesheets.create',
      class: 'mutation',
      description:
        'Create a Kimai timesheet entry for the authenticated user. Mirrors the activepieces `kimai.create.timesheet` action.',
      parameters: {
        type: 'object',
        properties: {
          begin: {
            type: 'string',
            description: 'ISO-8601 start datetime for the timesheet entry.',
          },
          end: {
            type: 'string',
            description: 'ISO-8601 end datetime for the timesheet entry. Optional for in-progress entries.',
          },
          project: {
            type: 'integer',
            description: 'Kimai project ID the timesheet belongs to.',
          },
          activity: {
            type: 'integer',
            description: 'Kimai activity ID for the timesheet entry.',
          },
          description: {
            type: 'string',
            description: 'Free-form description of the work logged.',
          },
          tags: {
            type: 'string',
            description: 'Comma-separated list of Kimai tag names.',
          },
        },
        required: ['begin', 'project', 'activity'],
      },
      request: {
        method: 'POST',
        path: '/api/timesheets',
        body: {
          begin: '{begin}',
          end: '{end}',
          project: '{project}',
          activity: '{activity}',
          description: '{description}',
          tags: '{tags}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'timesheets.stop',
      class: 'mutation',
      description:
        'Stop a running Kimai timesheet entry. Mirrors `PATCH /api/timesheets/{id}/stop`; the upstream sets the end time to "now" server-side and rejects calls against already-stopped entries.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'integer',
            description: 'Kimai timesheet ID to stop.',
          },
        },
        required: ['id'],
      },
      request: {
        method: 'PATCH',
        path: '/api/timesheets/{id}/stop',
        body: {},
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'timesheets.list',
      class: 'read',
      description:
        'List Kimai timesheet entries. Mirrors `GET /api/timesheets` and supports filtering by user, project, activity, plus paging.',
      parameters: {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            description: 'Kimai user ID to filter by, or "all" to list across users (requires teamlead privileges).',
          },
          project: {
            type: 'integer',
            description: 'Kimai project ID to filter by.',
          },
          activity: {
            type: 'integer',
            description: 'Kimai activity ID to filter by.',
          },
          page: {
            type: 'integer',
            description: 'Page number (1-indexed).',
          },
          size: {
            type: 'integer',
            description: 'Page size (items per page).',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/api/timesheets',
        query: {
          user: '{user}',
          project: '{project}',
          activity: '{activity}',
          page: '{page}',
          size: '{size}',
        },
      },
    },
    {
      name: 'projects.list',
      class: 'read',
      description:
        'List Kimai projects. Mirrors `GET /api/projects`; supports filtering by visibility and customer.',
      parameters: {
        type: 'object',
        properties: {
          visible: {
            type: 'integer',
            description: 'Filter by visibility: 1=visible, 2=hidden, 3=both.',
          },
          customer: {
            type: 'integer',
            description: 'Kimai customer ID to filter projects by.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/api/projects',
        query: {
          visible: '{visible}',
          customer: '{customer}',
        },
      },
    },
  ],
})
