import { declarativeRestConnector } from './declarative-rest.js'

export const sardisConnector = declarativeRestConnector({
  kind: 'sardis',
  displayName: 'Sardis',
  description: 'Policy-controlled payments for AI agents.',
  auth: { kind: 'api-key', hint: 'Sardis API key for your agent.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.sardis.io/v1',
  test: { method: 'GET', path: '/agent/balance' },
  capabilities: [
    {
      name: 'payment.send',
      class: 'mutation',
      description: 'Send a payment with policy validation.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string' },
          amount: { type: 'number' },
          memo: { type: 'string' },
          agentId: { type: 'string' },
          policyText: { type: 'string' },
        },
        required: ['to', 'amount', 'agentId', 'policyText'],
      },
      request: {
        method: 'POST',
        path: '/payment/send',
        body: {
          to: '{to}',
          amount: '{amount}',
          memo: '{memo}',
          agentId: '{agentId}',
          policyText: '{policyText}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'balance.check',
      class: 'read',
      description: 'Check agent balance.',
      parameters: {
        type: 'object',
        properties: { agentId: { type: 'string' } },
        required: ['agentId'],
      },
      request: {
        method: 'GET',
        path: '/agent/balance',
        query: { agentId: '{agentId}' },
      },
    },
    {
      name: 'policy.check',
      class: 'read',
      description: 'Check if a payment complies with spending policy.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          amount: { type: 'number' },
          merchant: { type: 'string' },
        },
        required: ['agentId', 'amount', 'merchant'],
      },
      request: {
        method: 'GET',
        path: '/policy/check',
        query: {
          agentId: '{agentId}',
          amount: '{amount}',
          merchant: '{merchant}',
        },
      },
    },
    {
      name: 'policy.set',
      class: 'mutation',
      description: 'Set spending policy for an agent.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          policyText: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['agentId', 'policyText'],
      },
      request: {
        method: 'POST',
        path: '/policy/set',
        body: {
          agentId: '{agentId}',
          policyText: '{policyText}',
          limit: '{limit}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'transactions.list',
      class: 'read',
      description: 'List transactions for an agent.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['agentId'],
      },
      request: {
        method: 'GET',
        path: '/transactions',
        query: {
          agentId: '{agentId}',
          limit: '{limit}',
        },
      },
    },
  ],
})
