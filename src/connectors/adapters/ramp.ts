import { declarativeRestConnector } from './declarative-rest.js'

export const rampConnector = declarativeRestConnector({
  kind: 'ramp',
  displayName: 'Ramp',
  description: 'Read Ramp cards, users, transactions, reimbursements, vendors, and spend programs.',
  auth: {
    kind: 'api-key',
    hint: 'Ramp OAuth access token. Create a free developer app or customer-issued API connection and paste the bearer token.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://api.ramp.com/api/v1' },
  allowedBaseUrls: ['https://api.ramp.com/api/v1', 'https://demo-api.ramp.com/api/v1'],
  test: { method: 'GET', path: '/users', query: { page_size: '1' } },
  capabilities: [
    rampList('users.list', '/users', 'List Ramp users and their status.'),
    rampList('cards.list', '/cards', 'List physical and virtual cards.'),
    rampList('transactions.list', '/transactions', 'List card transactions and accounting status.'),
    rampList('reimbursements.list', '/reimbursements', 'List employee reimbursements.'),
    rampList('vendors.list', '/vendors', 'List vendors known to Ramp.'),
    rampList('spend-programs.list', '/spend-programs', 'List spend programs and controls.'),
  ],
})

function rampList(name: string, path: string, description: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: {
      type: 'object',
      properties: {
        page_size: { type: 'integer', minimum: 1, maximum: 100 },
        page: { type: 'string', description: 'Opaque next-page cursor.' },
      },
    },
    request: { method: 'GET' as const, path, query: { page_size: '{page_size}', page: '{page}' } },
  }
}
