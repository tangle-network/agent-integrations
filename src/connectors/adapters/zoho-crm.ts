import { declarativeRestConnector } from './declarative-rest.js'

// Zoho CRM uses a region-partitioned API surface. The accounts (OAuth) host and
// the API host differ per data center (com / eu / in / com.au / jp / com.cn).
// The accounts host below is the US default; tenants in other regions must
// supply `metadata.apiDomain` (returned from the token endpoint as `api_domain`)
// so the runtime can target the correct region without re-deploying the adapter.
// Authentication is non-standard: Zoho requires `Authorization: Zoho-oauthtoken
// <token>` rather than the conventional Bearer prefix, so we route through the
// declarative-rest `header` credential placement with an explicit prefix.
//
// Mutation contract: Zoho wraps every write payload as `{ data: [...], trigger:
// [...] }`. We surface that envelope directly on the action input rather than
// hiding it behind a `fields` alias because Zoho's REST API is natively batched
// (up to 100 records per call) and faking a single-record shape would either
// silently drop batches or break trigger semantics.

const moduleParam = {
  type: 'string',
  description: 'CRM module API name, e.g. Leads, Contacts, Accounts, Deals, Tasks.',
} as const

const triggerParam = {
  type: 'array',
  items: { type: 'string', enum: ['approval', 'workflow', 'blueprint'] },
  description: 'Server-side automations to fire after the write. Omit to skip all.',
} as const

const dataParam = {
  type: 'array',
  items: { type: 'object' },
  description: 'Array of records (field API name → value). Zoho v6 accepts up to 100 records per call.',
  minItems: 1,
  maxItems: 100,
} as const

export const zohoCrmConnector = declarativeRestConnector({
  kind: 'zoho-crm',
  displayName: 'Zoho CRM',
  description: 'Search Zoho CRM records, read records by id, and create or update modules such as Leads, Contacts, Accounts, and Deals.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
    tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
    scopes: ['ZohoCRM.modules.ALL', 'ZohoCRM.users.READ', 'ZohoCRM.settings.READ', 'offline_access'],
    clientIdEnv: 'ZOHO_CRM_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ZOHO_CRM_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiDomain', fallback: 'https://www.zohoapis.com' },
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Zoho-oauthtoken ' },
  test: { method: 'GET', path: '/crm/v6/users', query: { type: 'CurrentUser' } },
  capabilities: [
    {
      name: 'records.list',
      class: 'read',
      description: 'List records in a module with pagination and optional field projection.',
      parameters: {
        type: 'object',
        properties: {
          module: moduleParam,
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 200 },
          fields: { type: 'string', description: 'Comma-separated list of field API names to project.' },
          sort_by: { type: 'string' },
          sort_order: { type: 'string', enum: ['asc', 'desc'] },
        },
        required: ['module'],
      },
      request: {
        method: 'GET',
        path: '/crm/v6/{module}',
        query: {
          page: '{page}',
          per_page: '{per_page}',
          fields: '{fields}',
          sort_by: '{sort_by}',
          sort_order: '{sort_order}',
        },
      },
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
    {
      name: 'records.search',
      class: 'read',
      description: 'Search records in a module by criteria, email, phone, or word. Supply at least one filter.',
      parameters: {
        type: 'object',
        properties: {
          module: moduleParam,
          criteria: { type: 'string', description: 'Zoho criteria syntax, e.g. (Last_Name:equals:Smith)' },
          email: { type: 'string' },
          phone: { type: 'string' },
          word: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 200 },
        },
        required: ['module'],
      },
      request: {
        method: 'GET',
        path: '/crm/v6/{module}/search',
        query: {
          criteria: '{criteria}',
          email: '{email}',
          phone: '{phone}',
          word: '{word}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Read a single Zoho CRM record by id.',
      parameters: {
        type: 'object',
        properties: {
          module: moduleParam,
          recordId: { type: 'string' },
          fields: { type: 'string', description: 'Comma-separated list of field API names to project.' },
        },
        required: ['module', 'recordId'],
      },
      request: {
        method: 'GET',
        path: '/crm/v6/{module}/{recordId}',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create one or more records in a module (batched up to 100 per call).',
      parameters: {
        type: 'object',
        properties: {
          module: moduleParam,
          data: dataParam,
          trigger: triggerParam,
        },
        required: ['module', 'data'],
      },
      request: {
        method: 'POST',
        path: '/crm/v6/{module}',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update an existing Zoho CRM record by id. Pass `data: [{ ...patch }]`.',
      parameters: {
        type: 'object',
        properties: {
          module: moduleParam,
          recordId: { type: 'string' },
          data: dataParam,
          trigger: triggerParam,
        },
        required: ['module', 'recordId', 'data'],
      },
      request: {
        method: 'PUT',
        path: '/crm/v6/{module}/{recordId}',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
    {
      name: 'records.upsert',
      class: 'mutation',
      description: 'Upsert records into a module using duplicate_check_fields. Inserts on miss, updates on match.',
      parameters: {
        type: 'object',
        properties: {
          module: moduleParam,
          data: dataParam,
          duplicate_check_fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Field API names Zoho should use to detect an existing record.',
          },
          trigger: triggerParam,
        },
        required: ['module', 'data', 'duplicate_check_fields'],
      },
      request: {
        method: 'POST',
        path: '/crm/v6/{module}/upsert',
        body: {
          data: '{data}',
          duplicate_check_fields: '{duplicate_check_fields}',
          trigger: '{trigger}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record by id. wf_trigger=false suppresses workflows attached to the module.',
      parameters: {
        type: 'object',
        properties: {
          module: moduleParam,
          recordId: { type: 'string' },
          wf_trigger: { type: 'boolean' },
        },
        required: ['module', 'recordId'],
      },
      request: {
        method: 'DELETE',
        path: '/crm/v6/{module}/{recordId}',
        query: { wf_trigger: '{wf_trigger}' },
      },
      cas: 'none',
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
  ],
})
