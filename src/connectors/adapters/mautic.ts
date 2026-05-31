import { declarativeRestConnector } from './declarative-rest.js'

// Mautic is a self-hosted open-source marketing automation platform. Each
// installation lives at a customer-controlled base URL (e.g.
// https://mautic.example.com), so the connection stores the resolved host as
// `baseUrl` metadata. Mautic's REST API is rooted at `/api/*` and accepts
// HTTP Basic Auth with the API user's username + password — the activepieces
// piece marks this as `api_key` and collects `username`, `password`,
// `base_url`, plus webhook-naming fields. The catalog ships no actions, so
// the capability surface here mirrors Mautic's published REST endpoints for
// contacts, companies, and segments — the core CRM-style objects the
// platform manages.
export const mauticConnector = declarativeRestConnector({
  kind: 'mautic',
  displayName: 'Mautic',
  description:
    'Manage Mautic contacts, companies, and segments in the open-source marketing automation platform.',
  auth: {
    kind: 'api-key',
    hint: 'Mautic Basic Auth credentials (username + password) with API access enabled. Connection metadata must include the install baseUrl (e.g. https://mautic.example.com).',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl' },
  test: { method: 'GET', path: '/api/contacts?limit=1' },
  capabilities: [
    {
      name: 'contacts.search',
      class: 'read',
      description:
        'Search Mautic contacts. Supports the Mautic `search` query syntax (e.g. "email:user@example.com").',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          start: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          orderBy: { type: 'string' },
          orderByDir: { type: 'string', enum: ['asc', 'desc'] },
          published: { type: 'boolean' },
          minimal: { type: 'boolean' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/contacts',
        query: {
          search: '{search}',
          start: '{start}',
          limit: '{limit}',
          orderBy: '{orderBy}',
          orderByDir: '{orderByDir}',
          published: '{published}',
          minimal: '{minimal}',
        },
      },
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Read a single Mautic contact by id.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'integer' } },
        required: ['contactId'],
      },
      request: { method: 'GET', path: '/api/contacts/{contactId}' },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description:
        'Create a Mautic contact. Standard fields (email, firstname, lastname) and any custom field aliases may be supplied at the top level.',
      parameters: {
        type: 'object',
        properties: {
          contact: {
            type: 'object',
            properties: {
              email: { type: 'string', format: 'email' },
              firstname: { type: 'string' },
              lastname: { type: 'string' },
              company: { type: 'string' },
              position: { type: 'string' },
              phone: { type: 'string' },
              mobile: { type: 'string' },
              address1: { type: 'string' },
              address2: { type: 'string' },
              city: { type: 'string' },
              state: { type: 'string' },
              zipcode: { type: 'string' },
              country: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              ipAddress: { type: 'string' },
              owner: { type: 'integer' },
            },
          },
        },
        required: ['contact'],
      },
      request: { method: 'POST', path: '/api/contacts/new', body: '{contact}' },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description:
        'Update (PATCH) a Mautic contact by id. Only the supplied fields are modified; omit a field to leave it untouched.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'integer' },
          contact: {
            type: 'object',
            properties: {
              email: { type: 'string', format: 'email' },
              firstname: { type: 'string' },
              lastname: { type: 'string' },
              company: { type: 'string' },
              position: { type: 'string' },
              phone: { type: 'string' },
              mobile: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              owner: { type: 'integer' },
            },
          },
        },
        required: ['contactId', 'contact'],
      },
      request: {
        method: 'PATCH',
        path: '/api/contacts/{contactId}/edit',
        body: '{contact}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete a Mautic contact by id.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'integer' } },
        required: ['contactId'],
      },
      request: { method: 'DELETE', path: '/api/contacts/{contactId}/delete' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.segments.add',
      class: 'mutation',
      description: 'Add a contact to a segment (list).',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'integer' },
          segmentId: { type: 'integer' },
        },
        required: ['contactId', 'segmentId'],
      },
      request: {
        method: 'POST',
        path: '/api/segments/{segmentId}/contact/{contactId}/add',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.segments.remove',
      class: 'mutation',
      description: 'Remove a contact from a segment (list).',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'integer' },
          segmentId: { type: 'integer' },
        },
        required: ['contactId', 'segmentId'],
      },
      request: {
        method: 'POST',
        path: '/api/segments/{segmentId}/contact/{contactId}/remove',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'segments.search',
      class: 'read',
      description: 'List or search Mautic segments (contact lists).',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          start: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          orderBy: { type: 'string' },
          orderByDir: { type: 'string', enum: ['asc', 'desc'] },
          published: { type: 'boolean' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/segments',
        query: {
          search: '{search}',
          start: '{start}',
          limit: '{limit}',
          orderBy: '{orderBy}',
          orderByDir: '{orderByDir}',
          published: '{published}',
        },
      },
    },
    {
      name: 'segments.get',
      class: 'read',
      description: 'Read a single Mautic segment by id.',
      parameters: {
        type: 'object',
        properties: { segmentId: { type: 'integer' } },
        required: ['segmentId'],
      },
      request: { method: 'GET', path: '/api/segments/{segmentId}' },
    },
    {
      name: 'companies.search',
      class: 'read',
      description: 'List or search Mautic companies.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          start: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          orderBy: { type: 'string' },
          orderByDir: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
      request: {
        method: 'GET',
        path: '/api/companies',
        query: {
          search: '{search}',
          start: '{start}',
          limit: '{limit}',
          orderBy: '{orderBy}',
          orderByDir: '{orderByDir}',
        },
      },
    },
    {
      name: 'companies.get',
      class: 'read',
      description: 'Read a single Mautic company by id.',
      parameters: {
        type: 'object',
        properties: { companyId: { type: 'integer' } },
        required: ['companyId'],
      },
      request: { method: 'GET', path: '/api/companies/{companyId}' },
    },
    {
      name: 'companies.create',
      class: 'mutation',
      description: 'Create a Mautic company record.',
      parameters: {
        type: 'object',
        properties: {
          company: {
            type: 'object',
            properties: {
              companyname: { type: 'string' },
              companyemail: { type: 'string', format: 'email' },
              companyaddress1: { type: 'string' },
              companyaddress2: { type: 'string' },
              companycity: { type: 'string' },
              companystate: { type: 'string' },
              companyzipcode: { type: 'string' },
              companycountry: { type: 'string' },
              companyphone: { type: 'string' },
              companywebsite: { type: 'string' },
              companyindustry: { type: 'string' },
              companyfax: { type: 'string' },
              companyannual_revenue: { type: 'number' },
              companynumber_of_employees: { type: 'integer' },
              companydescription: { type: 'string' },
            },
            required: ['companyname'],
          },
        },
        required: ['company'],
      },
      request: { method: 'POST', path: '/api/companies/new', body: '{company}' },
      cas: 'native-idempotency',
    },
    {
      name: 'companies.update',
      class: 'mutation',
      description: 'Update a Mautic company by id.',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'integer' },
          company: {
            type: 'object',
            properties: {
              companyname: { type: 'string' },
              companyemail: { type: 'string', format: 'email' },
              companyphone: { type: 'string' },
              companywebsite: { type: 'string' },
              companyindustry: { type: 'string' },
              companydescription: { type: 'string' },
            },
          },
        },
        required: ['companyId', 'company'],
      },
      request: {
        method: 'PATCH',
        path: '/api/companies/{companyId}/edit',
        body: '{company}',
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
