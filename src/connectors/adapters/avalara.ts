import { declarativeRestConnector } from './declarative-rest.js'

const companyCode = { type: 'string', description: 'Avalara company code.' } as const
const transactionCode = { type: 'string', description: 'Merchant transaction code.' } as const
const model = {
  type: 'object',
  description: 'Provider-native AvaTax v2 request model.',
} as const

export const avalaraConnector = declarativeRestConnector({
  kind: 'avalara',
  displayName: 'Avalara AvaTax',
  description:
    'Calculate tax and manage AvaTax transaction documents, adjustments, commits, voids, and refunds.',
  auth: {
    kind: 'api-key',
    hint: 'JSON credential bundle: {"accountId":"...","licenseKey":"..."}. Use apiBaseUrl metadata for the sandbox host when needed.',
  },
  category: 'commerce',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://rest.avatax.com' },
  allowedBaseUrls: ['https://rest.avatax.com', 'https://sandbox-rest.avatax.com'],
  credentialPlacement: {
    kind: 'basic-structured',
    usernameField: 'accountId',
    passwordField: 'licenseKey',
  },
  test: { method: 'GET', path: '/api/v2/utilities/ping' },
  capabilities: [
    {
      name: 'rates.by-address',
      class: 'read',
      description: 'Estimate the total tax rate for one postal address.',
      parameters: {
        type: 'object',
        properties: {
          line1: { type: 'string' },
          city: { type: 'string' },
          region: { type: 'string' },
          postalCode: { type: 'string' },
          country: { type: 'string' },
        },
        required: ['postalCode', 'country'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/taxrates/byaddress',
        query: {
          line1: '{line1}', city: '{city}', region: '{region}',
          postalCode: '{postalCode}', country: '{country}',
        },
      },
    },
    {
      name: 'definitions.tax-codes.list',
      class: 'read',
      description: 'List Avalara system tax codes for product classification.',
      parameters: {
        type: 'object',
        properties: {
          top: { type: 'integer', minimum: 1, maximum: 1000 },
          skip: { type: 'integer', minimum: 0 },
          filter: { type: 'string' },
          orderBy: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/definitions/taxcodes',
        query: { '$top': '{top}', '$skip': '{skip}', '$filter': '{filter}', '$orderby': '{orderBy}' },
      },
    },
    {
      name: 'transactions.create',
      class: 'mutation',
      description: 'Create an AvaTax transaction document and calculate its tax.',
      parameters: {
        type: 'object',
        properties: { model },
        required: ['model'],
      },
      request: { method: 'POST', path: '/api/v2/transactions/create', body: '{model}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'transactions.create-or-adjust',
      class: 'mutation',
      description: 'Create a transaction or adjust the existing transaction with the same company/code/type.',
      parameters: {
        type: 'object',
        properties: { model },
        required: ['model'],
      },
      request: { method: 'POST', path: '/api/v2/transactions/createoradjust', body: '{model}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    transactionRead('transactions.get', '', 'Read one AvaTax transaction and its summary.'),
    {
      name: 'transactions.audit',
      class: 'read',
      description: 'Read the audit trail for one AvaTax transaction.',
      parameters: {
        type: 'object',
        properties: { companyCode, transactionCode },
        required: ['companyCode', 'transactionCode'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/companies/{companyCode}/transactions/{transactionCode}/audit',
      },
    },
    transactionAction('transactions.commit', '/commit', 'Commit a transaction for reporting and filing.'),
    transactionAction('transactions.void', '/void', 'Void a transaction with an explicit AvaTax void reason.'),
    transactionAction('transactions.refund', '/refund', 'Create a full or partial refund transaction.'),
    transactionAction('transactions.lock', '/lock', 'Lock a transaction against further edits.'),
    {
      name: 'companies.list',
      class: 'read',
      description: 'List AvaTax companies accessible to the account.',
      parameters: {
        type: 'object',
        properties: {
          top: { type: 'integer', minimum: 1, maximum: 1000 },
          skip: { type: 'integer', minimum: 0 },
          filter: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v2/companies',
        query: { '$top': '{top}', '$skip': '{skip}', '$filter': '{filter}' },
      },
    },
  ],
})

function transactionRead(name: string, suffix: string, description: string) {
  return {
    name,
    class: 'read' as const,
    description,
    parameters: {
      type: 'object',
      properties: {
        companyCode,
        transactionCode,
        documentType: { type: 'string' },
        include: { type: 'string', description: 'Related response objects to include.' },
      },
      required: ['companyCode', 'transactionCode'],
    },
    request: {
      method: 'GET' as const,
      path: `/api/v2/companies/{companyCode}/transactions/{transactionCode}${suffix}`,
      query: { documentType: '{documentType}', '$include': '{include}' },
    },
  }
}

function transactionAction(name: string, suffix: string, description: string) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: {
      type: 'object',
      properties: {
        companyCode,
        transactionCode,
        documentType: { type: 'string' },
        include: { type: 'string', description: 'Related response objects to include.' },
        model,
      },
      required: ['companyCode', 'transactionCode', 'model'],
    },
    request: {
      method: 'POST' as const,
      path: `/api/v2/companies/{companyCode}/transactions/{transactionCode}${suffix}`,
      query: { documentType: '{documentType}', '$include': '{include}' },
      body: '{model}',
    },
    cas: 'native-idempotency' as const,
    externalEffect: true,
  }
}
