import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Marketo REST API — lead lifecycle (search, get, upsert), static list
 * membership, and campaign trigger. Every Marketo subscription has its own
 * Munchkin-scoped REST endpoint (`https://{munchkinId}.mktorest.com`), so the
 * adapter resolves `baseUrl` from `metadata.restEndpoint` populated during
 * connection setup.
 *
 * Marketo's primary machine-to-machine auth is client_credentials against
 * `/identity/oauth/token`. For embedded LaunchPoint apps the same identity
 * service exposes a 3-legged authorize endpoint at `/identity/oauth/authorize`
 * which we surface here so the hub OAuth handler can negotiate a per-user
 * token. Marketo does not honour granular OAuth scopes — capability is gated
 * by the service user's API Role in the Marketo Admin UI — so we leave the
 * scope set empty and document the requirement in the auth hint via the
 * description on each capability.
 *
 * Lead upserts use POST /rest/v1/leads.json with an `action` of
 * `createOrUpdate`; Marketo returns per-row status (`created`, `updated`,
 * `skipped`) under `result[]` and the call is naturally idempotent when the
 * caller supplies a `lookupField` (default `email`).
 */
export const marketoConnector = declarativeRestConnector({
  kind: 'marketo',
  displayName: 'Marketo',
  description: 'Manage Marketo leads, static lists, and smart campaigns through the REST API v1.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.marketo.com/identity/oauth/authorize',
    tokenUrl: 'https://app.marketo.com/identity/oauth/token',
    scopes: [],
    clientIdEnv: 'MARKETO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MARKETO_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'restEndpoint' },
  test: { method: 'GET', path: '/rest/v1/stats/usage.json' },
  capabilities: [
    {
      name: 'leads.search',
      class: 'read',
      description: 'Look up leads by a filter field (e.g. email, id, leadId). Marketo returns up to 300 records per page.',
      parameters: {
        type: 'object',
        properties: {
          filterType: {
            type: 'string',
            description: 'Field name to filter by, e.g. "email", "id", "cookie", or any custom lead field marked searchable.',
          },
          filterValues: {
            type: 'string',
            description: 'Comma-separated list of values to match against filterType (max 300 values).',
          },
          fields: {
            type: 'string',
            description: 'Comma-separated list of Marketo lead fields to return; omit for the default set.',
          },
          batchSize: { type: 'number', description: 'Page size, 1-300; defaults to 300.' },
          nextPageToken: { type: 'string', description: 'Paging token from a previous response.' },
        },
        required: ['filterType', 'filterValues'],
      },
      request: {
        method: 'GET',
        path: '/rest/v1/leads.json',
        query: {
          filterType: '{filterType}',
          filterValues: '{filterValues}',
          fields: '{fields}',
          batchSize: '{batchSize}',
          nextPageToken: '{nextPageToken}',
        },
      },
    },
    {
      name: 'leads.get',
      class: 'read',
      description: 'Read a single lead by Marketo lead id.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'Marketo internal lead id (integer-as-string).' },
          fields: { type: 'string', description: 'Comma-separated Marketo lead fields to return.' },
        },
        required: ['leadId'],
      },
      request: {
        method: 'GET',
        path: '/rest/v1/lead/{leadId}.json',
        query: { fields: '{fields}' },
      },
    },
    {
      name: 'leads.describe',
      class: 'read',
      description: 'Describe the lead schema — returns the full set of fields available on the lead object including custom fields.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/rest/v1/leads/describe.json' },
    },
    {
      name: 'leads.upsert',
      class: 'mutation',
      description: 'Create or update one or more leads. Idempotent on the lookupField (default "email"); body shape `{ action, lookupField, input }`.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Operation: createOnly, updateOnly, createOrUpdate (default), createDuplicate.',
          },
          lookupField: {
            type: 'string',
            description: 'Field Marketo uses to match existing leads (default "email").',
          },
          input: {
            type: 'array',
            description: 'Array of lead records keyed by Marketo field names.',
            items: { type: 'object' },
          },
          partitionName: {
            type: 'string',
            description: 'Optional lead partition name when the workspace has multiple partitions.',
          },
        },
        required: ['input'],
      },
      request: { method: 'POST', path: '/rest/v1/leads.json', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'lists.search',
      class: 'read',
      description: 'List static lists. Filter by id, name, programName, or workspaceName.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Comma-separated list ids to filter.' },
          name: { type: 'string', description: 'Comma-separated list names to filter.' },
          batchSize: { type: 'number' },
          nextPageToken: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/rest/v1/lists.json',
        query: {
          id: '{id}',
          name: '{name}',
          batchSize: '{batchSize}',
          nextPageToken: '{nextPageToken}',
        },
      },
    },
    {
      name: 'lists.get',
      class: 'read',
      description: 'Read a single Marketo static list by id.',
      parameters: {
        type: 'object',
        properties: { listId: { type: 'string' } },
        required: ['listId'],
      },
      request: { method: 'GET', path: '/rest/v1/lists/{listId}.json' },
    },
    {
      name: 'lists.add-leads',
      class: 'mutation',
      description: 'Add one or more leads to a static list. Body shape `{ input: [{ id }] }`.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          input: {
            type: 'array',
            description: 'Array of `{ id }` objects referencing Marketo lead ids.',
            items: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
          },
        },
        required: ['listId', 'input'],
      },
      request: { method: 'POST', path: '/rest/v1/lists/{listId}/leads.json', body: { input: '{input}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'lists.remove-leads',
      class: 'mutation',
      description: 'Remove one or more leads from a static list. Body shape `{ input: [{ id }] }`.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          input: {
            type: 'array',
            description: 'Array of `{ id }` objects referencing Marketo lead ids.',
            items: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
          },
        },
        required: ['listId', 'input'],
      },
      request: { method: 'DELETE', path: '/rest/v1/lists/{listId}/leads.json', body: { input: '{input}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'campaigns.search',
      class: 'read',
      description: 'List smart campaigns. Filter by id, name, programName, or workspaceName.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Comma-separated campaign ids.' },
          name: { type: 'string', description: 'Comma-separated campaign names.' },
          programName: { type: 'string' },
          workspaceName: { type: 'string' },
          batchSize: { type: 'number' },
          nextPageToken: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/rest/v1/campaigns.json',
        query: {
          id: '{id}',
          name: '{name}',
          programName: '{programName}',
          workspaceName: '{workspaceName}',
          batchSize: '{batchSize}',
          nextPageToken: '{nextPageToken}',
        },
      },
    },
    {
      name: 'campaigns.trigger',
      class: 'mutation',
      description: 'Request execution of a trigger campaign for one or more leads. Body shape `{ input: { leads: [{ id }], tokens?: [{ name, value }] } }`.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string' },
          input: {
            type: 'object',
            description: 'Marketo trigger payload: `{ leads: [{ id }], tokens?: [{ name, value }] }`.',
            properties: {
              leads: {
                type: 'array',
                items: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
              },
              tokens: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { name: { type: 'string' }, value: { type: 'string' } },
                  required: ['name', 'value'],
                },
              },
            },
            required: ['leads'],
          },
        },
        required: ['campaignId', 'input'],
      },
      request: {
        method: 'POST',
        path: '/rest/v1/campaigns/{campaignId}/trigger.json',
        body: { input: '{input}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'activities.search',
      class: 'read',
      description: 'Fetch lead activities since a paging token. Caller obtains the initial token from /rest/v1/activities/pagingtoken.json.',
      parameters: {
        type: 'object',
        properties: {
          nextPageToken: { type: 'string', description: 'Marketo paging token bounding the activity window.' },
          activityTypeIds: { type: 'string', description: 'Comma-separated activity type ids; up to 10 per call.' },
          leadIds: { type: 'string', description: 'Comma-separated lead ids; up to 30 per call.' },
          assetIds: { type: 'string' },
          listId: { type: 'string' },
          batchSize: { type: 'number' },
        },
        required: ['nextPageToken', 'activityTypeIds'],
      },
      request: {
        method: 'GET',
        path: '/rest/v1/activities.json',
        query: {
          nextPageToken: '{nextPageToken}',
          activityTypeIds: '{activityTypeIds}',
          leadIds: '{leadIds}',
          assetIds: '{assetIds}',
          listId: '{listId}',
          batchSize: '{batchSize}',
        },
      },
    },
  ],
})
