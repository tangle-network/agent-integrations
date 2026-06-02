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
    {
      // Lead conversion is a Zoho-specific compound write: the request must
      // supply at least one of `Contacts` / `Accounts` / `Deals` inside `data[0]`
      // and Zoho returns the created ids per target module. We surface those
      // sub-objects verbatim rather than aliasing — the Zoho contract is the
      // contract; aliasing here would mask real-world fields (Notify_Lead_Owner,
      // overwrite, etc.). Native idempotency via Zoho's duplicate-conversion
      // guard.
      name: 'records.convert',
      class: 'mutation',
      description: 'Convert a Lead into Contact + optional Account/Deal. data[0] carries the conversion payload (Contacts/Accounts/Deals sub-objects, Notify_Lead_Owner, overwrite, etc.).',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'Lead record id to convert.' },
          data: {
            type: 'array',
            items: { type: 'object' },
            description: 'Single-element array with the Zoho conversion payload (Contacts, Accounts, Deals, Notify_Lead_Owner, overwrite, etc.).',
            minItems: 1,
            maxItems: 1,
          },
        },
        required: ['leadId', 'data'],
      },
      request: {
        method: 'POST',
        path: '/crm/v6/Leads/{leadId}/actions/convert',
        body: { data: '{data}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
    {
      // Mass-reassign endpoint. `ids` is the slice of record ids to move and
      // `data[0]` carries the new Owner sub-object. Zoho also supports a
      // territory transfer but that is a different capability surface; we keep
      // this one targeted at ownership transfer.
      name: 'records.assign',
      class: 'mutation',
      description: 'Reassign one or more records in a module to a new owner. data[0] must carry the new Owner sub-object (e.g. { Owner: { id: "USER_ID" } }).',
      parameters: {
        type: 'object',
        properties: {
          module: moduleParam,
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Record ids to reassign (up to 100 per call).',
            minItems: 1,
            maxItems: 100,
          },
          data: {
            type: 'array',
            items: { type: 'object' },
            description: 'Single-element array carrying the Owner sub-object Zoho should apply to every id.',
            minItems: 1,
            maxItems: 1,
          },
        },
        required: ['module', 'ids', 'data'],
      },
      request: {
        method: 'POST',
        path: '/crm/v6/{module}/actions/mass_change_owner',
        body: { ids: '{ids}', data: '{data}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
    {
      // Notes attach to any module record via the parent_id link. We accept
      // the flat Note_Title / Note_Content shape Zoho wants directly on
      // data[0], so the caller doesn't have to know Zoho's envelope wrapping
      // shape beyond "pass the note fields as one record".
      name: 'notes.create',
      class: 'mutation',
      description: 'Attach a note to a record. data[0] must include Note_Title (optional), Note_Content, Parent_Id, and se_module (the parent module API name).',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'array',
            items: { type: 'object' },
            description: 'Note records (Note_Title, Note_Content, Parent_Id, se_module). Up to 100 per call.',
            minItems: 1,
            maxItems: 100,
          },
        },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/crm/v6/Notes',
        body: { data: '{data}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
    {
      // Zoho supports three file-attachment modes: multipart upload, link
      // attachment (attachmentUrl), and Zoho-Docs/Workdrive linkage. The
      // declarative-rest transport is JSON-only, so we wire the URL-based
      // form — attachmentUrl is a public download URL Zoho fetches server-side
      // and stores against the record. Multipart streaming attachment is a
      // separate, non-declarative capability and is intentionally out of scope
      // here.
      name: 'files.upload',
      class: 'mutation',
      description: 'Attach a file to a record by URL. Zoho fetches the URL server-side and links the resulting attachment to the parent record.',
      parameters: {
        type: 'object',
        properties: {
          module: moduleParam,
          recordId: { type: 'string' },
          attachmentUrl: { type: 'string', description: 'Publicly reachable URL Zoho will fetch and attach.' },
        },
        required: ['module', 'recordId', 'attachmentUrl'],
      },
      request: {
        method: 'POST',
        path: '/crm/v6/{module}/{recordId}/Attachments',
        query: { attachmentUrl: '{attachmentUrl}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['ZohoCRM.modules.ALL'],
    },
  ],
})
