import { declarativeRestConnector } from './declarative-rest.js'

export const brexConnector = declarativeRestConnector({
  kind: 'brex',
  displayName: 'Brex',
  description: 'Read Brex users, cards, card transactions, vendors, expenses, and payments.',
  auth: {
    kind: 'api-key',
    hint: 'Brex OAuth access token or customer-generated user token, stored as a bearer token.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://platform.brexapis.com',
  test: { method: 'GET', path: '/v2/users', query: { limit: '1' } },
  capabilities: [
    brexList('users.list', '/v2/users', 'List Brex users.'),
    brexList('cards.list', '/v2/cards', 'List Brex cards and card status.'),
    brexList('card-transactions.list', '/v2/transactions/card/primary', 'List primary card transactions.'),
    brexList('vendors.list', '/v1/vendors', 'List vendors configured in Brex.'),
    brexList('expenses.list', '/v1/expenses/card', 'List card expenses and receipt/memo status.'),
    brexList('payments.list', '/v1/payments', 'List outbound payments.'),
  ],
})

function brexList(name: string, path: string, description: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        cursor: { type: 'string' },
      },
    },
    request: { method: 'GET' as const, path, query: { limit: '{limit}', cursor: '{cursor}' } },
  }
}
