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
  ],
})
