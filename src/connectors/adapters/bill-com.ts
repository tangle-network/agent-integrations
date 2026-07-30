import { declarativeRestConnector } from './declarative-rest.js'

/** BILL v3 connections supply a developer key plus an organization-scoped
 *  session id. Store them as JSON `{ "developerKey": "...", "sessionId":
 *  "..." }`; both stay in the encrypted credential envelope. */
export const billComConnector = declarativeRestConnector({
  kind: 'bill-com',
  displayName: 'BILL',
  description: 'Read vendors, bills, payments, and chart-of-account records through the BILL API v3.',
  auth: {
    kind: 'api-key',
    hint: 'JSON credential bundle: {"developerKey":"...","sessionId":"..."}.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://gateway.prod.bill.com/connect/v3',
  credentialPlacement: {
    kind: 'structured-headers',
    fields: { developerKey: 'devKey', sessionId: 'sessionId' },
  },
  test: { method: 'GET', path: '/vendors', query: { max: '1' } },
  capabilities: [
    billList('vendors.list', '/vendors', 'List vendors.'),
    billList('bills.list', '/bills', 'List accounts-payable bills.'),
    billList('payments.list', '/payments', 'List payments.'),
    billList('chart-of-accounts.list', '/chart-of-accounts', 'List chart-of-account records.'),
  ],
})

function billList(name: string, path: string, description: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: {
      type: 'object',
      properties: {
        max: { type: 'integer', minimum: 1, maximum: 100 },
        page: { type: 'string' },
      },
    },
    request: { method: 'GET' as const, path, query: { max: '{max}', page: '{page}' } },
  }
}
