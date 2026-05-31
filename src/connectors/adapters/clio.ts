import { declarativeRestConnector } from './declarative-rest.js'

// Clio Manage REST v4 — https://app.clio.com/api/v4/documentation
//
// OAuth2 endpoints from
//   https://docs.developers.clio.com/api-docs/authentication/
//   authorize: https://app.clio.com/oauth/authorize
//   token:     https://app.clio.com/oauth/token
//
// Clio is regionalized: US (app.clio.com), EU (eu.app.clio.com),
// CA (ca.app.clio.com), AU (au.app.clio.com). The OAuth host AND the API host
// move together per region. The manifest pins US as the authorize/token URL
// because that is what `clientIdEnv`/`clientSecretEnv` resolve against by
// default, and lets the consumer override the per-tenant API host via
// `metadata.apiBaseUrl` so EU/CA/AU customers route to the right shard
// without forking the adapter. Same per-tenant base-URL seam Salesforce uses
// for `instanceUrl`, Pipedrive for `apiDomain`, and Basecamp for
// `accountBaseUrl`.
//
// Scopes: Clio's public-app OAuth grant is all-or-nothing — the consent
// screen does not surface named scopes; the connected app inherits the
// authorizing user's full permission set within the Clio account. We model
// that as an empty `scopes` array (matches clickup / basecamp precedent in
// this repo) rather than fabricating fake scope names that Clio would
// silently ignore.
//
// Idempotency: Clio does not honor an `Idempotency-Key` header; create
// operations are modelled as `native-idempotency` because the hub-side
// idempotency cache (declarative-rest) is what enforces dedupe on replay,
// not the server. Updates use If-Match against the resource's etag — Clio
// emits etags on individual resource fetches and the framework wires
// `inv.expectedEtag` into the `if-match` header automatically.
//
// All Clio v4 endpoints carry a `.json` suffix; the paths below preserve
// that exactly.
export const clioConnector = declarativeRestConnector({
  kind: 'clio',
  displayName: 'Clio',
  description:
    'Read and mutate Clio Manage contacts, matters, tasks, time-entry activities, and notes via the Clio v4 REST API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.clio.com/oauth/authorize',
    tokenUrl: 'https://app.clio.com/oauth/token',
    scopes: [],
    clientIdEnv: 'CLIO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CLIO_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  // Consumer pins `metadata.apiBaseUrl` to the region's host
  // (https://app.clio.com, https://eu.app.clio.com, https://ca.app.clio.com,
  // https://au.app.clio.com); US is the documented default fallback.
  baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://app.clio.com' },
  // GET /api/v4/users/who_am_i.json — returns the authorizing user; cheap
  // liveness probe that exercises auth without mutating state.
  test: { method: 'GET', path: '/api/v4/users/who_am_i.json' },
  capabilities: [
    {
      name: 'users.whoami',
      class: 'read',
      description: 'Return the Clio user whose token is currently authorizing the connection.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/api/v4/users/who_am_i.json' },
    },
    {
      name: 'contacts.list',
      class: 'read',
      description:
        'List Clio contacts (people and companies). Supports the Clio query parameter for free-text search and the standard limit/page pagination.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search term.' },
          type: {
            type: 'string',
            enum: ['Person', 'Company'],
            description: 'Filter to people or companies only.',
          },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          page_token: { type: 'string', description: 'Cursor returned by a prior page.' },
          fields: {
            type: 'string',
            description: 'Comma-separated v4 field selector (e.g. "id,name,primary_email_address").',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v4/contacts.json',
        query: {
          query: '{query}',
          type: '{type}',
          limit: '{limit}',
          page_token: '{page_token}',
          fields: '{fields}',
        },
      },
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Read a single Clio contact by id.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          fields: { type: 'string' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'GET',
        path: '/api/v4/contacts/{contactId}.json',
        query: { fields: '{fields}' },
      },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a Clio contact (person or company). Body must be wrapped in Clio\'s {data: {...}} envelope.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description: 'Clio contact attributes (name, type, email_addresses, phone_numbers, etc.).',
          },
        },
        required: ['data'],
      },
      request: { method: 'POST', path: '/api/v4/contacts.json', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update a Clio contact by id. Uses etag If-Match for optimistic concurrency.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['contactId', 'data'],
      },
      request: { method: 'PATCH', path: '/api/v4/contacts/{contactId}.json', body: { data: '{data}' } },
      cas: 'etag-if-match',
    },
    {
      name: 'matters.list',
      class: 'read',
      description:
        'List Clio matters (cases). Filter by status, responsible attorney, client, or free-text query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          status: { type: 'string', enum: ['Open', 'Pending', 'Closed'] },
          client_id: { type: 'string' },
          responsible_attorney_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          page_token: { type: 'string' },
          fields: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v4/matters.json',
        query: {
          query: '{query}',
          status: '{status}',
          client_id: '{client_id}',
          responsible_attorney_id: '{responsible_attorney_id}',
          limit: '{limit}',
          page_token: '{page_token}',
          fields: '{fields}',
        },
      },
    },
    {
      name: 'matters.get',
      class: 'read',
      description: 'Read a single Clio matter by id.',
      parameters: {
        type: 'object',
        properties: {
          matterId: { type: 'string' },
          fields: { type: 'string' },
        },
        required: ['matterId'],
      },
      request: {
        method: 'GET',
        path: '/api/v4/matters/{matterId}.json',
        query: { fields: '{fields}' },
      },
    },
    {
      name: 'matters.create',
      class: 'mutation',
      description: 'Create a Clio matter (legal case).',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description:
              'Clio matter attributes: description, client (object with id), practice_area (object with id), responsible_attorney, status, etc.',
          },
        },
        required: ['data'],
      },
      request: { method: 'POST', path: '/api/v4/matters.json', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'matters.update',
      class: 'mutation',
      description: 'Update a Clio matter by id.',
      parameters: {
        type: 'object',
        properties: {
          matterId: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['matterId', 'data'],
      },
      request: { method: 'PATCH', path: '/api/v4/matters/{matterId}.json', body: { data: '{data}' } },
      cas: 'etag-if-match',
    },
    {
      name: 'tasks.list',
      class: 'read',
      description: 'List Clio tasks. Filter by matter, assignee, status, or due date.',
      parameters: {
        type: 'object',
        properties: {
          matter_id: { type: 'string' },
          assignee_id: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'complete'] },
          due_at_from: { type: 'string', description: 'ISO 8601 lower bound.' },
          due_at_to: { type: 'string', description: 'ISO 8601 upper bound.' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          page_token: { type: 'string' },
          fields: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v4/tasks.json',
        query: {
          matter_id: '{matter_id}',
          assignee_id: '{assignee_id}',
          status: '{status}',
          due_at_from: '{due_at_from}',
          due_at_to: '{due_at_to}',
          limit: '{limit}',
          page_token: '{page_token}',
          fields: '{fields}',
        },
      },
    },
    {
      name: 'tasks.get',
      class: 'read',
      description: 'Read a single Clio task by id.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          fields: { type: 'string' },
        },
        required: ['taskId'],
      },
      request: {
        method: 'GET',
        path: '/api/v4/tasks/{taskId}.json',
        query: { fields: '{fields}' },
      },
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a Clio task.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description:
              'Clio task attributes: name, description, due_at, priority, assignee (object with id), matter (object with id), status.',
          },
        },
        required: ['data'],
      },
      request: { method: 'POST', path: '/api/v4/tasks.json', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'tasks.update',
      class: 'mutation',
      description: 'Update a Clio task by id.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['taskId', 'data'],
      },
      request: { method: 'PATCH', path: '/api/v4/tasks/{taskId}.json', body: { data: '{data}' } },
      cas: 'etag-if-match',
    },
    {
      name: 'activities.list',
      class: 'read',
      description:
        'List Clio activities (time and expense entries). Filter by matter, user, type, or date range.',
      parameters: {
        type: 'object',
        properties: {
          matter_id: { type: 'string' },
          user_id: { type: 'string' },
          type: { type: 'string', enum: ['TimeEntry', 'ExpenseEntry'] },
          date_from: { type: 'string', description: 'ISO 8601 date lower bound.' },
          date_to: { type: 'string', description: 'ISO 8601 date upper bound.' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          page_token: { type: 'string' },
          fields: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v4/activities.json',
        query: {
          matter_id: '{matter_id}',
          user_id: '{user_id}',
          type: '{type}',
          date_from: '{date_from}',
          date_to: '{date_to}',
          limit: '{limit}',
          page_token: '{page_token}',
          fields: '{fields}',
        },
      },
    },
    {
      name: 'activities.create',
      class: 'mutation',
      description:
        'Log a Clio activity (billable time or expense entry) against a matter.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description:
              'Clio activity attributes: type ("TimeEntry"|"ExpenseEntry"), date, quantity (seconds for time / units for expense), price, matter (object with id), activity_description (object with id), note, non_billable.',
          },
        },
        required: ['data'],
      },
      request: { method: 'POST', path: '/api/v4/activities.json', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'notes.list',
      class: 'read',
      description: 'List Clio notes scoped to a matter or contact.',
      parameters: {
        type: 'object',
        properties: {
          matter_id: { type: 'string' },
          contact_id: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          page_token: { type: 'string' },
          fields: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v4/notes.json',
        query: {
          matter_id: '{matter_id}',
          contact_id: '{contact_id}',
          limit: '{limit}',
          page_token: '{page_token}',
          fields: '{fields}',
        },
      },
    },
    {
      name: 'notes.create',
      class: 'mutation',
      description: 'Create a Clio note attached to a matter or contact.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description:
              'Clio note attributes: subject, detail, type ("Matter"|"Contact"), and the parent reference (matter or contact object with id).',
          },
        },
        required: ['data'],
      },
      request: { method: 'POST', path: '/api/v4/notes.json', body: 'args' },
      cas: 'native-idempotency',
    },
  ],
})
