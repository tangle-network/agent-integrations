import { declarativeRestConnector } from './declarative-rest.js'

export const digitalPilotConnector = declarativeRestConnector({
  kind: 'digital-pilot',
  displayName: 'DigitalPilot',
  description: 'Manage target accounts and monitor high-intent visits in DigitalPilot.',
  auth: {
    kind: 'api-key',
    hint: 'DigitalPilot API key and account domain.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiUrl' },
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'target-accounts.add',
      class: 'mutation',
      description: 'Add a target account to track in DigitalPilot.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'The account ID to add' },
          accountName: { type: 'string', description: 'The account name' },
          domain: { type: 'string', description: 'Account domain' },
        },
        required: ['accountId', 'accountName'],
      },
      request: {
        method: 'POST',
        path: '/target-accounts',
        body: {
          accountId: '{accountId}',
          accountName: '{accountName}',
          domain: '{domain}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'target-accounts.remove',
      class: 'mutation',
      description: 'Remove a target account from DigitalPilot.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'The account ID to remove' },
        },
        required: ['accountId'],
      },
      request: {
        method: 'DELETE',
        path: '/target-accounts/{accountId}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'visits.search',
      class: 'read',
      description: 'Search high-intent visits from target accounts.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string', description: 'Filter by target account ID' },
          intentLevel: { type: 'string', description: 'Filter by intent level (high, medium, low)' },
          limit: { type: 'integer', description: 'Maximum number of results' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/visits',
        query: {
          accountId: '{accountId}',
          intentLevel: '{intentLevel}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'visits.get',
      class: 'read',
      description: 'Get details of a specific visit.',
      parameters: {
        type: 'object',
        properties: {
          visitId: { type: 'string', description: 'The visit ID' },
        },
        required: ['visitId'],
      },
      request: {
        method: 'GET',
        path: '/visits/{visitId}',
      },
    },
  ],
})
