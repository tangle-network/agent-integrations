import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Kommo CRM (https://developers.kommo.com).
 *
 * Auth: long-lived access token sent as Bearer in the Authorization header.
 * Each Kommo account lives on a per-tenant subdomain
 * (https://{subdomain}.kommo.com), so the connection stores the resolved
 * `apiBaseUrl` in metadata (e.g. https://acme.kommo.com/api/v4) and the
 * connector reads it via metadataKey.
 *
 * The activepieces catalog entry lists no explicit actions, so the surface
 * below maps the documented public v4 REST resources used by the piece's
 * auth-fields (contacts/leads/companies, plus tasks and notes that the
 * pipeline ops depend on). The `query` / `tags_to_add` / `tags_to_delete` /
 * `price` auth-fields the catalog enumerates are surfaced as parameters on
 * the matching search/update capabilities.
 */
export const kommoConnector = declarativeRestConnector({
  kind: 'kommo',
  displayName: 'Kommo',
  description:
    'Read and mutate Kommo CRM leads, contacts, companies, tasks, and notes for the messenger-first sales pipeline.',
  auth: {
    kind: 'api-key',
    hint: 'Kommo long-lived access token. The connection must also store the per-account apiBaseUrl (e.g. https://yourcompany.kommo.com/api/v4).',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiBaseUrl' },
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Bearer ' },
  defaultHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'account.get',
      class: 'read',
      description: 'Fetch the current Kommo account profile (subdomain, currency, timezone).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/account' },
    },
    {
      name: 'leads.search',
      class: 'read',
      description: 'Search leads by free-text query, pipeline, or status.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/leads',
        query: { query: '{query}', page: '{page}', limit: '{limit}' },
      },
    },
    {
      name: 'leads.get',
      class: 'read',
      description: 'Fetch a single Kommo lead by id, with linked contacts and pipeline status.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'integer' } },
        required: ['leadId'],
      },
      request: { method: 'GET', path: '/leads/{leadId}' },
    },
    {
      name: 'leads.create',
      class: 'mutation',
      description: 'Create one or more leads. Body is the array envelope Kommo expects.',
      parameters: {
        type: 'object',
        properties: {
          leads: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                price: { type: 'number' },
                status_id: { type: 'integer' },
                pipeline_id: { type: 'integer' },
                responsible_user_id: { type: 'integer' },
                custom_fields_values: { type: 'array' },
                _embedded: { type: 'object' },
              },
            },
          },
        },
        required: ['leads'],
      },
      request: { method: 'POST', path: '/leads', body: '{leads}' },
      cas: 'native-idempotency',
    },
    {
      name: 'leads.update',
      class: 'mutation',
      description: 'Update a Kommo lead by id (rename, change pipeline/status, change price, attach tags).',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'integer' },
          name: { type: 'string' },
          price: { type: 'number' },
          status_id: { type: 'integer' },
          pipeline_id: { type: 'integer' },
          responsible_user_id: { type: 'integer' },
          custom_fields_values: { type: 'array' },
          _embedded: { type: 'object' },
        },
        required: ['leadId'],
      },
      request: {
        method: 'PATCH',
        path: '/leads/{leadId}',
        body: {
          name: '{name}',
          price: '{price}',
          status_id: '{status_id}',
          pipeline_id: '{pipeline_id}',
          responsible_user_id: '{responsible_user_id}',
          custom_fields_values: '{custom_fields_values}',
          _embedded: '{_embedded}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.search',
      class: 'read',
      description: 'Search contacts by free-text query (name, email, phone).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/contacts',
        query: { query: '{query}', page: '{page}', limit: '{limit}' },
      },
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Fetch a single Kommo contact by id.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'integer' } },
        required: ['contactId'],
      },
      request: { method: 'GET', path: '/contacts/{contactId}' },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description:
        'Create one or more contacts. Mirrors the activepieces piece auth-fields (name, first_name, last_name, email, phone, tags).',
      parameters: {
        type: 'object',
        properties: {
          contacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                first_name: { type: 'string' },
                last_name: { type: 'string' },
                responsible_user_id: { type: 'integer' },
                custom_fields_values: { type: 'array' },
                _embedded: { type: 'object' },
              },
              required: ['name'],
            },
          },
        },
        required: ['contacts'],
      },
      request: { method: 'POST', path: '/contacts', body: '{contacts}' },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update a Kommo contact by id (name, first_name, last_name, custom field values).',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'integer' },
          name: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          responsible_user_id: { type: 'integer' },
          custom_fields_values: { type: 'array' },
          _embedded: { type: 'object' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'PATCH',
        path: '/contacts/{contactId}',
        body: {
          name: '{name}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          responsible_user_id: '{responsible_user_id}',
          custom_fields_values: '{custom_fields_values}',
          _embedded: '{_embedded}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'companies.search',
      class: 'read',
      description:
        'Search companies by free-text query — mirrors the catalog `query` auth-field (searches through filled company fields).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
        required: ['query'],
      },
      request: {
        method: 'GET',
        path: '/companies',
        query: { query: '{query}', page: '{page}', limit: '{limit}' },
      },
    },
    {
      name: 'companies.get',
      class: 'read',
      description: 'Fetch a single Kommo company by id.',
      parameters: {
        type: 'object',
        properties: { companyId: { type: 'integer' } },
        required: ['companyId'],
      },
      request: { method: 'GET', path: '/companies/{companyId}' },
    },
    {
      name: 'companies.create',
      class: 'mutation',
      description: 'Create one or more companies.',
      parameters: {
        type: 'object',
        properties: {
          companies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                responsible_user_id: { type: 'integer' },
                custom_fields_values: { type: 'array' },
                _embedded: { type: 'object' },
              },
              required: ['name'],
            },
          },
        },
        required: ['companies'],
      },
      request: { method: 'POST', path: '/companies', body: '{companies}' },
      cas: 'native-idempotency',
    },
    {
      name: 'companies.update',
      class: 'mutation',
      description: 'Update a Kommo company by id.',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'integer' },
          name: { type: 'string' },
          responsible_user_id: { type: 'integer' },
          custom_fields_values: { type: 'array' },
          _embedded: { type: 'object' },
        },
        required: ['companyId'],
      },
      request: {
        method: 'PATCH',
        path: '/companies/{companyId}',
        body: {
          name: '{name}',
          responsible_user_id: '{responsible_user_id}',
          custom_fields_values: '{custom_fields_values}',
          _embedded: '{_embedded}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tags.add',
      class: 'mutation',
      description:
        'Attach tags to a lead/contact/company via the entity update endpoint — mirrors the `tags_to_add` auth-field.',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['leads', 'contacts', 'companies'] },
          entityId: { type: 'integer' },
          _embedded: { type: 'object' },
        },
        required: ['entityType', 'entityId', '_embedded'],
      },
      request: {
        method: 'PATCH',
        path: '/{entityType}/{entityId}',
        body: { _embedded: '{_embedded}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tags.remove',
      class: 'mutation',
      description:
        'Remove tags from a lead/contact/company by re-sending the desired tag set — mirrors the `tags_to_delete` auth-field.',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['leads', 'contacts', 'companies'] },
          entityId: { type: 'integer' },
          _embedded: { type: 'object' },
        },
        required: ['entityType', 'entityId', '_embedded'],
      },
      request: {
        method: 'PATCH',
        path: '/{entityType}/{entityId}',
        body: { _embedded: '{_embedded}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'tasks.search',
      class: 'read',
      description: 'List tasks scoped to a responsible user or pipeline.',
      parameters: {
        type: 'object',
        properties: {
          responsible_user_id: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/tasks',
        query: {
          'filter[responsible_user_id]': '{responsible_user_id}',
          page: '{page}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create one or more tasks against a lead/contact/company.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                complete_till: { type: 'integer' },
                task_type_id: { type: 'integer' },
                entity_type: { type: 'string' },
                entity_id: { type: 'integer' },
                responsible_user_id: { type: 'integer' },
              },
              required: ['text', 'complete_till'],
            },
          },
        },
        required: ['tasks'],
      },
      request: { method: 'POST', path: '/tasks', body: '{tasks}' },
      cas: 'native-idempotency',
    },
    {
      name: 'notes.create',
      class: 'mutation',
      description: 'Add notes to a lead/contact/company.',
      parameters: {
        type: 'object',
        properties: {
          entityType: { type: 'string', enum: ['leads', 'contacts', 'companies'] },
          notes: { type: 'array' },
        },
        required: ['entityType', 'notes'],
      },
      request: { method: 'POST', path: '/{entityType}/notes', body: '{notes}' },
      cas: 'native-idempotency',
    },
  ],
})
