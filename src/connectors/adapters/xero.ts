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
    // Xero apps created with granular scopes reject the legacy umbrella
    // `accounting.transactions` and `accounting.reports.read` scopes. Keep
    // reads and writes explicit, including each report family this adapter
    // advertises, so consent matches the provider's current app configuration.
    scopes: [
      'offline_access',
      'app.connections',
      'accounting.contacts',
      'accounting.contacts.read',
      'accounting.invoices',
      'accounting.invoices.read',
      'accounting.payments',
      'accounting.settings.read',
      'accounting.reports.aged.read',
      'accounting.reports.balancesheet.read',
      'accounting.reports.banksummary.read',
      'accounting.reports.profitandloss.read',
      'accounting.reports.trialbalance.read',
    ],
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
      // Every other Xero capability REQUIRES `tenantId`, and a tenant id is an
      // opaque GUID no caller can know before asking. Without this read the
      // connector is unusable by an agent: the only place the id appeared was
      // the health check, which discards its body.
      name: 'tenants.list',
      class: 'read',
      description:
        'List the Xero organizations (tenants) this connection is authorized for. Call this FIRST — every other Xero capability requires the `tenantId` returned here.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/connections' },
      requiredScopes: ['app.connections'],
    },
    {
      // Xero's reporting surface, like QBO's, is a separate namespace from the
      // record endpoints. These are the statements a return or a books review
      // is actually built from.
      name: 'reports.get',
      class: 'read',
      description:
        'Run a Xero accounting report. `reportName` is the Xero report id (ProfitAndLoss, BalanceSheet, TrialBalance, BankSummary, AgedReceivablesByContact, AgedPayablesByContact).',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string', description: 'From tenants.list.' },
          reportName: {
            type: 'string',
            enum: [
              'ProfitAndLoss',
              'BalanceSheet',
              'TrialBalance',
              'BankSummary',
              'AgedReceivablesByContact',
              'AgedPayablesByContact',
            ],
          },
          fromDate: { type: 'string', description: 'YYYY-MM-DD.' },
          toDate: { type: 'string', description: 'YYYY-MM-DD.' },
          date: { type: 'string', description: 'YYYY-MM-DD — point-in-time reports (BalanceSheet, TrialBalance).' },
          contactId: { type: 'string', description: 'Required by the aged receivables/payables reports.' },
        },
        required: ['tenantId', 'reportName'],
      },
      request: {
        method: 'GET',
        path: '/api.xro/2.0/Reports/{reportName}',
        query: { fromDate: '{fromDate}', toDate: '{toDate}', date: '{date}', contactID: '{contactId}' },
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      requiredScopes: [
        'accounting.reports.aged.read',
        'accounting.reports.balancesheet.read',
        'accounting.reports.banksummary.read',
        'accounting.reports.profitandloss.read',
        'accounting.reports.trialbalance.read',
      ],
    },
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
      requiredScopes: ['accounting.contacts.read'],
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
      requiredScopes: ['accounting.contacts.read'],
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
      requiredScopes: ['accounting.invoices.read'],
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
      requiredScopes: ['accounting.invoices.read'],
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
      requiredScopes: ['accounting.invoices'],
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
    {
      name: 'contacts.archive',
      class: 'mutation',
      description: 'Archive a Xero contact (sets ContactStatus to ARCHIVED).',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          contactId: { type: 'string', description: 'Xero ContactID (GUID).' },
        },
        required: ['tenantId', 'contactId'],
      },
      request: {
        method: 'POST',
        path: '/api.xro/2.0/Contacts/{contactId}',
        body: { ContactStatus: 'ARCHIVED' },
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['accounting.contacts'],
    },
    {
      name: 'invoices.delete',
      class: 'mutation',
      description: 'Void or delete a Xero invoice. DRAFT/SUBMITTED invoices accept DELETED, AUTHORISED invoices accept VOIDED.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          invoiceId: { type: 'string', description: 'Xero InvoiceID (GUID) or InvoiceNumber.' },
          status: {
            type: 'string',
            enum: ['VOIDED', 'DELETED'],
            description: 'Target status. VOIDED for authorised invoices, DELETED for draft/submitted invoices.',
          },
        },
        required: ['tenantId', 'invoiceId', 'status'],
      },
      request: {
        method: 'POST',
        path: '/api.xro/2.0/Invoices/{invoiceId}',
        body: { Status: '{status}' },
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['accounting.invoices'],
    },
    {
      name: 'invoices.email',
      class: 'mutation',
      description: 'Email a Xero invoice to its contact using the saved template.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          invoiceId: { type: 'string', description: 'Xero InvoiceID (GUID) or InvoiceNumber.' },
        },
        required: ['tenantId', 'invoiceId'],
      },
      request: {
        method: 'POST',
        path: '/api.xro/2.0/Invoices/{invoiceId}/Email',
        body: {},
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['accounting.invoices'],
    },
    {
      name: 'payments.create',
      class: 'mutation',
      description: 'Apply a payment to a Xero invoice or credit note. Pass a Payments array per the Xero API contract.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          Payments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Invoice: { type: 'object', description: 'Invoice reference, e.g. { InvoiceID: "..." }.' },
                CreditNote: { type: 'object', description: 'CreditNote reference, e.g. { CreditNoteID: "..." }.' },
                Account: { type: 'object', description: 'Bank account reference, e.g. { Code: "090" }.' },
                Date: { type: 'string', description: 'YYYY-MM-DD.' },
                Amount: { type: 'number' },
                Reference: { type: 'string' },
              },
              required: ['Account', 'Date', 'Amount'],
            },
          },
        },
        required: ['tenantId', 'Payments'],
      },
      request: {
        method: 'POST',
        path: '/api.xro/2.0/Payments',
        body: { Payments: '{Payments}' },
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['accounting.payments'],
    },
    {
      name: 'credit-notes.create',
      class: 'mutation',
      description: 'Create a Xero credit note (ACCRECCREDIT or ACCPAYCREDIT). Pass a CreditNotes array per the Xero API contract.',
      parameters: {
        type: 'object',
        properties: {
          tenantId: { type: 'string' },
          CreditNotes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Type: { type: 'string', enum: ['ACCRECCREDIT', 'ACCPAYCREDIT'] },
                Contact: { type: 'object' },
                LineItems: { type: 'array', items: { type: 'object' } },
                Date: { type: 'string', description: 'YYYY-MM-DD.' },
                Reference: { type: 'string' },
                Status: { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'AUTHORISED'] },
              },
              required: ['Type', 'Contact', 'LineItems'],
            },
          },
        },
        required: ['tenantId', 'CreditNotes'],
      },
      request: {
        method: 'POST',
        path: '/api.xro/2.0/CreditNotes',
        body: { CreditNotes: '{CreditNotes}' },
        headers: { 'xero-tenant-id': '{tenantId}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['accounting.invoices'],
    },
  ],
})
