import { declarativeRestConnector } from './declarative-rest.js'

/** Plaid item access. The encrypted credential value is JSON with
 *  `{ "clientId": "...", "secret": "...", "accessToken": "..." }`.
 *  Plaid requires all three in every POST body; the shared transport injects
 *  them after rendering so model-authored arguments cannot replace secrets. */
export const plaidConnector = declarativeRestConnector({
  kind: 'plaid',
  displayName: 'Plaid',
  description: 'Read linked bank accounts, balances, transactions, identity, liabilities, and investments from Plaid.',
  auth: {
    kind: 'api-key',
    hint: 'JSON credential bundle: {"clientId":"...","secret":"...","accessToken":"..."}.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'environmentBaseUrl' },
  allowedBaseUrls: [
    'https://sandbox.plaid.com',
    'https://development.plaid.com',
    'https://production.plaid.com',
  ],
  credentialPlacement: {
    kind: 'structured-json-body',
    fields: { clientId: 'client_id', secret: 'secret', accessToken: 'access_token' },
  },
  defaultHeaders: { 'Plaid-Version': '2020-09-14' },
  test: { method: 'POST', path: '/accounts/get', body: {} },
  capabilities: [
    plaidRead('accounts.get', '/accounts/get', 'Read accounts and current/available balances for the linked Plaid item.'),
    plaidRead('auth.get', '/auth/get', 'Read account and routing numbers for checking and savings accounts.'),
    plaidRead('identity.get', '/identity/get', 'Read account-holder identity data supplied by the financial institution.'),
    plaidRead('liabilities.get', '/liabilities/get', 'Read credit-card, mortgage, and student-loan liabilities.'),
    plaidRead('investments.holdings.get', '/investments/holdings/get', 'Read investment holdings and security metadata.'),
    {
      name: 'transactions.sync',
      class: 'read',
      description: 'Incrementally synchronize transactions. Persist `next_cursor` and call again while `has_more` is true.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string' },
          count: { type: 'integer', minimum: 1, maximum: 500 },
          options: { type: 'object' },
        },
      },
      request: {
        method: 'POST',
        path: '/transactions/sync',
        body: { cursor: '{cursor}', count: '{count}', options: '{options}' },
      },
    },
  ],
})

function plaidRead(name: string, path: string, description: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: { type: 'object', properties: {} },
    request: { method: 'POST' as const, path, body: {} },
  }
}
