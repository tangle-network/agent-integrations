import { declarativeRestConnector } from './declarative-rest.js'

/** Sage Intacct REST API (not the legacy XML Web Services endpoint). The
 *  customer supplies an issued OAuth bearer token; no sender password or
 *  company-user password is placed in connection metadata. */
export const sageIntacctConnector = declarativeRestConnector({
  kind: 'sage-intacct',
  displayName: 'Sage Intacct',
  description: 'Read Sage Intacct vendors, customers, bills, invoices, and general-ledger accounts through the REST API.',
  auth: {
    kind: 'api-key',
    hint: 'Sage Intacct REST API OAuth access token, stored as a bearer token.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.intacct.com/ia/api/v1',
  test: { method: 'GET', path: '/objects/general-ledger/account', query: { limit: '1' } },
  capabilities: [
    intacctList('general-ledger.accounts.list', '/objects/general-ledger/account', 'List general-ledger accounts.'),
    intacctList('vendors.list', '/objects/accounts-payable/vendor', 'List accounts-payable vendors.'),
    intacctList('bills.list', '/objects/accounts-payable/bill', 'List accounts-payable bills.'),
    intacctList('customers.list', '/objects/accounts-receivable/customer', 'List accounts-receivable customers.'),
    intacctList('invoices.list', '/objects/accounts-receivable/invoice', 'List accounts-receivable invoices.'),
  ],
})

function intacctList(name: string, path: string, description: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
        offset: { type: 'integer', minimum: 0 },
        filter: { type: 'string' },
        fields: { type: 'string' },
      },
    },
    request: {
      method: 'GET' as const,
      path,
      query: { limit: '{limit}', offset: '{offset}', filter: '{filter}', fields: '{fields}' },
    },
  }
}
