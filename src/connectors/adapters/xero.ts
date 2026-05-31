import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Xero accounting connector.
 *
 * Auth: OAuth2 (Authorization Code + PKCE) via the Xero Identity service. After
 * consent the customer authorizes one or more Xero organizations ("tenants");
 * the chosen tenant id is passed on every API call via the `xero-tenant-id`
 * header. Because a single connection can span multiple tenants, the adapter
 * requires `tenantId` as an explicit argument on each capability rather than
 * pulling it from connection metadata — this mirrors how Salesforce requires
 * `objectName` per call.
 *
 * Capability surface = the finance/accounting action pack: read+create+update
 * for contacts and invoices, plus an account read for chart-of-accounts lookups.
 * All operations target the Xero Accounting REST API v2.0.
 */
export const xeroConnector = declarativeRestConnector({
  kind: 'xero',
  displayName: 'Xero',
  description: 'Search and update Xero contacts, invoices, and chart-of-account records across authorized organizations.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.xero.com/identity/connect/authorize',
    tokenUrl: 'https://identity.xero.com/connect/token',
    scopes: ['offline_access', 'accounting.contacts', 'accounting.transactions', 'accounting.settings.read'],
    clientIdEnv: 'XERO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'XERO_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.xero.com',
  defaultHeaders: { accept: 'application/json' },
  test: { method: 'GET', path: '/connections' },
  capabilities: [
    {
      name: 'contacts.search',
      class: 'read',
      description: 'Search Xero contacts in a tenant using the Xero where-clause query language.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'Xero tenant (organization) id from /connections.' },
          where: { type: 'string', description: 'Xero where clause, e.g. \'Name.Contains("Acme")\'.' },
          order: { type: 'string', description: 'Sort expression, e.g. "Name ASC".' },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['tenantId'],
      },
      request: {
        method: 'GET',
        path: '/api.xro/2.0/Contacts',
        query: { where: '{where}', order: '{order}', page: '{page}' },
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      requiredScopes: ['accounting.contacts'],
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Read a single Xero contact by ContactID.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          contactId: { type: 'string', description: 'Xero ContactID (GUID).' },
        },
        required: ['tenantId', 'contactId'],
      },
      request: {
        method: 'GET',
        path: '/api.xro/2.0/Contacts/{contactId}',
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      requiredScopes: ['accounting.contacts'],
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a Xero contact. Pass a Contacts array per the Xero API contract.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          Contacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Name: { type: 'string' },
                EmailAddress: { type: 'string' },
                FirstName: { type: 'string' },
                LastName: { type: 'string' },
              },
              required: ['Name'],
            },
          },
        },
        required: ['tenantId', 'Contacts'],
      },
      request: {
        method: 'POST',
        path: '/api.xro/2.0/Contacts',
        body: { Contacts: '{Contacts}' },
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['accounting.contacts'],
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update a Xero contact by ContactID.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          contactId: { type: 'string' },
          fields: { type: 'object', description: 'Partial Xero Contact payload.' },
        },
        required: ['tenantId', 'contactId', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/api.xro/2.0/Contacts/{contactId}',
        body: '{fields}',
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['accounting.contacts'],
    },
    {
      name: 'invoices.search',
      class: 'read',
      description: 'Search Xero invoices in a tenant.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          where: { type: 'string', description: 'Xero where clause, e.g. \'Status=="AUTHORISED"\'.' },
          order: { type: 'string', description: 'Sort expression, e.g. "Date DESC".' },
          page: { type: 'integer', minimum: 1 },
        },
        required: ['tenantId'],
      },
      request: {
        method: 'GET',
        path: '/api.xro/2.0/Invoices',
        query: { where: '{where}', order: '{order}', page: '{page}' },
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      requiredScopes: ['accounting.transactions'],
    },
    {
      name: 'invoices.get',
      class: 'read',
      description: 'Read a single Xero invoice by InvoiceID or InvoiceNumber.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          invoiceId: { type: 'string', description: 'Xero InvoiceID (GUID) or InvoiceNumber.' },
        },
        required: ['tenantId', 'invoiceId'],
      },
      request: {
        method: 'GET',
        path: '/api.xro/2.0/Invoices/{invoiceId}',
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      requiredScopes: ['accounting.transactions'],
    },
    {
      name: 'invoices.create',
      class: 'mutation',
      description: 'Create a Xero invoice (AR or AP). Pass an Invoices array per the Xero API contract.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          Invoices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Type: { type: 'string', enum: ['ACCREC', 'ACCPAY'] },
                Contact: { type: 'object' },
                LineItems: { type: 'array', items: { type: 'object' } },
                Date: { type: 'string', description: 'YYYY-MM-DD.' },
                DueDate: { type: 'string', description: 'YYYY-MM-DD.' },
                Reference: { type: 'string' },
                Status: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'AUTHORISED'] },
              },
              required: ['Type', 'Contact', 'LineItems'],
            },
          },
        },
        required: ['tenantId', 'Invoices'],
      },
      request: {
        method: 'POST',
        path: '/api.xro/2.0/Invoices',
        body: { Invoices: '{Invoices}' },
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['accounting.transactions'],
    },
    {
      name: 'accounts.search',
      class: 'read',
      description: 'List Xero chart-of-account records for a tenant.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          where: { type: 'string', description: 'Xero where clause, e.g. \'Type=="REVENUE"\'.' },
          order: { type: 'string' },
        },
        required: ['tenantId'],
      },
      request: {
        method: 'GET',
        path: '/api.xro/2.0/Accounts',
        query: { where: '{where}', order: '{order}' },
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      requiredScopes: ['accounting.settings.read'],
    },
  ],
})
