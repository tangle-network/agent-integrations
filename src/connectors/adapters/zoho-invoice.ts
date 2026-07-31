import { declarativeRestConnector } from './declarative-rest.js'

const organizationId = {
  type: 'string',
  description: 'Zoho Invoice organization id. Discover it with organizations.list.',
} as const

const data = {
  type: 'object',
  description: 'Provider-native Zoho Invoice request body.',
} as const

export const zohoInvoiceConnector = declarativeRestConnector({
  kind: 'zoho-invoice',
  displayName: 'Zoho Invoice',
  description: 'List, create, update, and send invoices through Zoho Invoice.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
    tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
    scopes: ['ZohoInvoice.fullaccess.all'],
    scopeSeparator: ',',
    clientIdEnv: 'ZOHO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ZOHO_OAUTH_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    tokenMetadata: {
      apiDomain: { field: 'api_domain', required: true },
    },
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiDomain', fallback: 'https://www.zohoapis.com' },
  allowedBaseUrlSuffixes: [
    '.zohoapis.com',
    '.zohoapis.eu',
    '.zohoapis.in',
    '.zohoapis.com.au',
    '.zohoapis.jp',
    '.zohoapis.ca',
    '.zohocloud.ca',
    '.zohoapis.com.cn',
    '.zohoapis.sa',
  ],
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Zoho-oauthtoken ' },
  test: { method: 'GET', path: '/invoice/v3/organizations' },
  capabilities: [
    {
      name: 'organizations.list',
      class: 'read',
      description: 'List organizations available to the connected Zoho Invoice user.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/invoice/v3/organizations' },
      requiredScopes: ['ZohoInvoice.fullaccess.all'],
    },
    {
      name: 'invoices.list',
      class: 'read',
      description: 'List invoices, optionally filtering by modification time, customer, or status.',
      parameters: {
        type: 'object',
        properties: {
          organization_id: organizationId,
          last_modified_at: { type: 'string', description: 'Provider date filter, YYYY-MM-DD.' },
          customer_id: { type: 'string' },
          status: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 200 },
        },
        required: ['organization_id'],
      },
      request: {
        method: 'GET',
        path: '/invoice/v3/invoices',
        query: {
          organization_id: '{organization_id}',
          last_modified_at: '{last_modified_at}',
          customer_id: '{customer_id}',
          status: '{status}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
      requiredScopes: ['ZohoInvoice.fullaccess.all'],
    },
    {
      name: 'invoices.get',
      class: 'read',
      description: 'Read one Zoho Invoice invoice.',
      parameters: {
        type: 'object',
        properties: { organization_id: organizationId, invoiceId: { type: 'string' } },
        required: ['organization_id', 'invoiceId'],
      },
      request: {
        method: 'GET',
        path: '/invoice/v3/invoices/{invoiceId}',
        query: { organization_id: '{organization_id}' },
      },
      requiredScopes: ['ZohoInvoice.fullaccess.all'],
    },
    {
      name: 'invoices.create',
      class: 'mutation',
      description: 'Create a Zoho Invoice invoice.',
      parameters: {
        type: 'object',
        properties: { organization_id: organizationId, data },
        required: ['organization_id', 'data'],
      },
      request: {
        method: 'POST',
        path: '/invoice/v3/invoices',
        query: { organization_id: '{organization_id}' },
        body: '{data}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['ZohoInvoice.fullaccess.all'],
    },
    {
      name: 'invoices.update',
      class: 'mutation',
      description: 'Update a Zoho Invoice invoice.',
      parameters: {
        type: 'object',
        properties: { organization_id: organizationId, invoiceId: { type: 'string' }, data },
        required: ['organization_id', 'invoiceId', 'data'],
      },
      request: {
        method: 'PUT',
        path: '/invoice/v3/invoices/{invoiceId}',
        query: { organization_id: '{organization_id}' },
        body: '{data}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['ZohoInvoice.fullaccess.all'],
    },
    {
      name: 'invoices.send',
      class: 'mutation',
      description: 'Email an existing Zoho Invoice invoice to its configured recipients.',
      parameters: {
        type: 'object',
        properties: { organization_id: organizationId, invoiceId: { type: 'string' }, data },
        required: ['organization_id', 'invoiceId', 'data'],
      },
      request: {
        method: 'POST',
        path: '/invoice/v3/invoices/{invoiceId}/email',
        query: { organization_id: '{organization_id}' },
        body: '{data}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['ZohoInvoice.fullaccess.all'],
    },
  ],
})
