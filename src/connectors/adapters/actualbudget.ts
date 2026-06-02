import { declarativeRestConnector } from './declarative-rest.js'

export const actualbudgetConnector = declarativeRestConnector({
  kind: 'actualbudget',
  displayName: 'Actual Budget',
  description: 'Query budget data, categories, and accounts. Import transactions.',
  auth: {
    kind: 'api-key',
    hint: 'Actual Budget server URL, password, and sync ID.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'serverUrl' },
  test: { method: 'GET', path: '/api/accounts' },
  capabilities: [
    {
      name: 'budget.get',
      class: 'read',
      description: 'Get budget for a specific month and year.',
      parameters: {
        type: 'object',
        properties: {
          month: { type: 'string' },
          year: { type: 'string' },
        },
        required: ['month', 'year'],
      },
      request: {
        method: 'GET',
        path: '/api/budget',
        query: { month: '{month}', year: '{year}' },
      },
    },
    {
      name: 'categories.list',
      class: 'read',
      description: 'List all transaction categories.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: {
        method: 'GET',
        path: '/api/categories',
      },
    },
    {
      name: 'accounts.list',
      class: 'read',
      description: 'List all accounts.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: {
        method: 'GET',
        path: '/api/accounts',
      },
    },
    {
      name: 'transactions.import',
      class: 'mutation',
      description: 'Import a single transaction into an account.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          payeeName: { type: 'string' },
          amount: { type: 'number' },
          date: { type: 'string' },
          category: { type: 'string' },
          notes: { type: 'string' },
          cleared: { type: 'boolean' },
          importedId: { type: 'string' },
        },
        required: ['accountId', 'date'],
      },
      request: {
        method: 'POST',
        path: '/api/transactions/import',
        body: {
          accountId: '{accountId}',
          payeeName: '{payeeName}',
          amount: '{amount}',
          date: '{date}',
          category: '{category}',
          notes: '{notes}',
          cleared: '{cleared}',
          importedId: '{importedId}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'transactions.batch-import',
      class: 'mutation',
      description: 'Import multiple transactions at once.',
      parameters: {
        type: 'object',
        properties: {
          transactions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                accountId: { type: 'string' },
                date: { type: 'string' },
                payeeName: { type: 'string' },
                amount: { type: 'number' },
                category: { type: 'string' },
                notes: { type: 'string' },
              },
              required: ['accountId', 'date'],
            },
          },
        },
        required: ['transactions'],
      },
      request: {
        method: 'POST',
        path: '/api/transactions/batch-import',
        body: '{transactions}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'transactions.create',
      class: 'mutation',
      description: 'Append a single transaction to the configured budget.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          date: { type: 'string' },
          payeeName: { type: 'string' },
          amount: { type: 'number' },
          category: { type: 'string' },
          notes: { type: 'string' },
          cleared: { type: 'boolean' },
        },
        required: ['accountId', 'date', 'amount'],
      },
      request: {
        method: 'POST',
        path: '/api/transactions',
        body: {
          accountId: '{accountId}',
          date: '{date}',
          payeeName: '{payeeName}',
          amount: '{amount}',
          category: '{category}',
          notes: '{notes}',
          cleared: '{cleared}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'transactions.update',
      class: 'mutation',
      description: 'Update amount/payee/category on an existing transaction.',
      parameters: {
        type: 'object',
        properties: {
          transactionId: { type: 'string' },
          amount: { type: 'number' },
          payeeName: { type: 'string' },
          category: { type: 'string' },
          notes: { type: 'string' },
          cleared: { type: 'boolean' },
        },
        required: ['transactionId'],
      },
      request: {
        method: 'PATCH',
        path: '/api/transactions/{transactionId}',
        body: {
          amount: '{amount}',
          payeeName: '{payeeName}',
          category: '{category}',
          notes: '{notes}',
          cleared: '{cleared}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'transactions.delete',
      class: 'mutation',
      description: 'Remove a transaction by id.',
      parameters: {
        type: 'object',
        properties: {
          transactionId: { type: 'string' },
        },
        required: ['transactionId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/transactions/{transactionId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'categories.create',
      class: 'mutation',
      description: 'Create a new budget category.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          groupId: { type: 'string' },
          isIncome: { type: 'boolean' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/api/categories',
        body: {
          name: '{name}',
          groupId: '{groupId}',
          isIncome: '{isIncome}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
