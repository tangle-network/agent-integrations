import { declarativeRestConnector } from './declarative-rest.js'

export const netsuiteConnector = declarativeRestConnector({
  kind: 'netsuite',
  displayName: 'NetSuite',
  description: 'Query SuiteAnalytics and read or create NetSuite customers, vendors, invoices, and vendor bills.',
  auth: {
    kind: 'api-key',
    hint: 'NetSuite OAuth 2.0 access token. Connection metadata must include the account-specific REST base URL.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiBaseUrl' },
  allowedBaseUrlSuffixes: ['.suitetalk.api.netsuite.com'],
  test: { method: 'GET', path: '/record/v1/customer', query: { limit: '1' } },
  capabilities: [
    {
      name: 'suiteql.query',
      class: 'read',
      description: 'Run a SuiteQL query. Use a bounded WHERE clause and page with limit/offset.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['query'],
      },
      request: {
        method: 'POST',
        path: '/query/v1/suiteql',
        query: { limit: '{limit}', offset: '{offset}' },
        headers: { Prefer: 'transient' },
        body: { q: '{query}' },
      },
    },
    recordList('customers.list', 'customer', 'List customer records.'),
    recordList('vendors.list', 'vendor', 'List vendor records.'),
    recordGet('invoices.get', 'invoice', 'invoiceId', 'Read an invoice by internal id.'),
    recordGet('vendor-bills.get', 'vendorBill', 'vendorBillId', 'Read a vendor bill by internal id.'),
  ],
})

function recordList(name: string, recordType: string, description: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer' }, offset: { type: 'integer' }, q: { type: 'string' } },
    },
    request: {
      method: 'GET' as const,
      path: `/record/v1/${recordType}`,
      query: { limit: '{limit}', offset: '{offset}', q: '{q}' },
    },
  }
}

function recordGet(name: string, recordType: string, idName: string, description: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: { type: 'object', properties: { [idName]: { type: 'string' } }, required: [idName] },
    request: { method: 'GET' as const, path: `/record/v1/${recordType}/{${idName}}` },
  }
}
