import { declarativeRestConnector } from './declarative-rest.js'

// Bigin is Zoho's lightweight CRM. It shares the regional data-center model and
// the non-standard `Authorization: Zoho-oauthtoken <token>` header with Zoho
// CRM, but the API base path is `/bigin/v2` and the OAuth scope namespace is
// `ZohoBigin.*`. Tenants in non-US data centers (eu / in / com.au / jp / com.cn)
// must surface `metadata.apiDomain` from the token response so we route to the
// correct regional host.
//
// Write payloads follow the Zoho envelope `{ data: [...], trigger: [...] }`
// across modules (Companies, Contacts, Tasks, Calls, Events, Pipelines). We
// surface that envelope on the action input rather than aliasing single-record
// shapes because Bigin natively batches up to 100 records per call.

const moduleParam = {
  type: 'string',
  description:
    'Bigin module API name. Common values: Accounts (Companies), Contacts, Tasks, Calls, Events, Pipelines, Products.',
} as const

const triggerParam = {
  type: 'array',
  items: { type: 'string', enum: ['approval', 'workflow', 'blueprint'] },
  description: 'Server-side automations to fire after the write. Omit to skip all.',
} as const

const dataParam = {
  type: 'array',
  items: { type: 'object' },
  description:
    'Array of records (field API name → value). Bigin v2 accepts up to 100 records per call.',
  minItems: 1,
  maxItems: 100,
} as const

export const biginByZohoConnector = declarativeRestConnector({
  kind: 'bigin-by-zoho',
  displayName: 'Bigin by Zoho CRM',
  description:
    'Manage Bigin by Zoho CRM: read and write companies, contacts, deals (pipeline records), tasks, calls, events, and search products and users.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
    tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
    scopes: [
      'ZohoBigin.modules.ALL',
      'ZohoBigin.users.READ',
      'ZohoBigin.settings.READ',
      'offline_access',
    ],
    clientIdEnv: 'BIGIN_BY_ZOHO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'BIGIN_BY_ZOHO_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiDomain', fallback: 'https://www.zohoapis.com' },
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Zoho-oauthtoken ' },
  test: { method: 'GET', path: '/bigin/v2/users', query: { type: 'CurrentUser' } },
  capabilities: [
    {
      name: 'records.search',
      class: 'read',
      description:
        'Search records in any Bigin module (Pipelines, Accounts, Contacts, Products) by criteria, email, phone, or free-text word.',
      parameters: {
        type: 'object',
        properties: {
          module: moduleParam,
          criteria: {
            type: 'string',
            description: 'Zoho criteria syntax, e.g. (Last_Name:equals:Smith)',
          },
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
        path: '/bigin/v2/{module}/search',
        query: {
          criteria: '{criteria}',
          email: '{email}',
          phone: '{phone}',
          word: '{word}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'users.search',
      class: 'read',
      description:
        'List users in the Bigin org. Filter via the `type` query (e.g. ActiveUsers, AdminUsers, CurrentUser).',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 200 },
        },
      },
      request: {
        method: 'GET',
        path: '/bigin/v2/users',
        query: { type: '{type}', page: '{page}', per_page: '{per_page}' },
      },
      requiredScopes: ['ZohoBigin.users.READ'],
    },
    {
      name: 'company.create',
      class: 'mutation',
      description: 'Create one or more companies (Accounts module). Batches up to 100 per call.',
      parameters: {
        type: 'object',
        properties: { data: dataParam, trigger: triggerParam },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/bigin/v2/Accounts',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'company.update',
      class: 'mutation',
      description: 'Update an existing company by record id.',
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          data: dataParam,
          trigger: triggerParam,
        },
        required: ['recordId', 'data'],
      },
      request: {
        method: 'PUT',
        path: '/bigin/v2/Accounts/{recordId}',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'contact.create',
      class: 'mutation',
      description: 'Create one or more contacts. Batches up to 100 per call.',
      parameters: {
        type: 'object',
        properties: { data: dataParam, trigger: triggerParam },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/bigin/v2/Contacts',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'contact.update',
      class: 'mutation',
      description: 'Update an existing contact by record id.',
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          data: dataParam,
          trigger: triggerParam,
        },
        required: ['recordId', 'data'],
      },
      request: {
        method: 'PUT',
        path: '/bigin/v2/Contacts/{recordId}',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'task.create',
      class: 'mutation',
      description: 'Create one or more tasks.',
      parameters: {
        type: 'object',
        properties: { data: dataParam, trigger: triggerParam },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/bigin/v2/Tasks',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'task.update',
      class: 'mutation',
      description: 'Update an existing task by record id.',
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          data: dataParam,
          trigger: triggerParam,
        },
        required: ['recordId', 'data'],
      },
      request: {
        method: 'PUT',
        path: '/bigin/v2/Tasks/{recordId}',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'call.create',
      class: 'mutation',
      description: 'Log one or more calls.',
      parameters: {
        type: 'object',
        properties: { data: dataParam, trigger: triggerParam },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/bigin/v2/Calls',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'event.create',
      class: 'mutation',
      description: 'Create one or more calendar events.',
      parameters: {
        type: 'object',
        properties: { data: dataParam, trigger: triggerParam },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/bigin/v2/Events',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'event.update',
      class: 'mutation',
      description: 'Update an existing calendar event by record id.',
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          data: dataParam,
          trigger: triggerParam,
        },
        required: ['recordId', 'data'],
      },
      request: {
        method: 'PUT',
        path: '/bigin/v2/Events/{recordId}',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'pipeline.record.create',
      class: 'mutation',
      description:
        'Create one or more pipeline records (deals). Bigin maps deals to the Pipelines module.',
      parameters: {
        type: 'object',
        properties: { data: dataParam, trigger: triggerParam },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/bigin/v2/Pipelines',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
    {
      name: 'pipeline.record.update',
      class: 'mutation',
      description: 'Update an existing pipeline record by record id.',
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          data: dataParam,
          trigger: triggerParam,
        },
        required: ['recordId', 'data'],
      },
      request: {
        method: 'PUT',
        path: '/bigin/v2/Pipelines/{recordId}',
        body: { data: '{data}', trigger: '{trigger}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['ZohoBigin.modules.ALL'],
    },
  ],
})
