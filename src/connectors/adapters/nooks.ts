import { declarativeRestConnector } from './declarative-rest.js'

// Nooks — AI sales engagement and dialer platform. Read call records, prospects, and accounts from the Nooks Sequencing API.
// Auth: api-key. Base: https://partner-api.nooks.in/v1. Docs: https://developer.nooks.in/
export const nooksConnector = declarativeRestConnector({
  kind: 'nooks',
  displayName: 'Nooks',
  description: 'AI sales engagement and dialer platform. Read call records, prospects, and accounts from the Nooks Sequencing API.',
  auth: {
    kind: 'api-key',
    hint: 'Create a long-lived API key (nooks-api-...) in Nooks Developer Settings -> API Keys. Sent as the Authorization: Bearer header.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://partner-api.nooks.in/v1',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json', accept: 'application/json' },
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'calls.list',
      class: 'read',
      description: 'List call records, with optional filters by prospect, account, or owner.',
      parameters: {
        type: 'object',
        properties: {
          filter_prospect_id: { type: 'string' },
          filter_account_id: { type: 'string' },
          filter_owner_id: { type: 'string' },
          include: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/calls',
        query: {
          'filter[prospect][id]': '{filter_prospect_id}',
          'filter[account][id]': '{filter_account_id}',
          'filter[owner][id]': '{filter_owner_id}',
          include: '{include}',
        },
      },
    },
    {
      name: 'calls.get',
      class: 'read',
      description: 'Get a single call record by its id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' }, include: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/calls/{id}', query: { include: '{include}' } },
    },
    {
      name: 'prospects.list',
      class: 'read',
      description: 'List prospects (contacts), with optional filters by name, email, or account.',
      parameters: {
        type: 'object',
        properties: {
          filter_name: { type: 'string' },
          filter_primaryEmail: { type: 'string' },
          filter_account_id: { type: 'string' },
          include: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/prospects',
        query: {
          'filter[name]': '{filter_name}',
          'filter[primaryEmail]': '{filter_primaryEmail}',
          'filter[account][id]': '{filter_account_id}',
          include: '{include}',
        },
      },
    },
    {
      name: 'accounts.list',
      class: 'read',
      description: 'List accounts, with optional filters by name, domain, or CRM id.',
      parameters: {
        type: 'object',
        properties: {
          filter_name: { type: 'string' },
          filter_domain: { type: 'string' },
          filter_crmId: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/accounts',
        query: {
          'filter[name]': '{filter_name}',
          'filter[domain]': '{filter_domain}',
          'filter[crmId]': '{filter_crmId}',
        },
      },
    },
    {
      name: 'prospects.sync',
      class: 'mutation',
      description: 'Sync prospects from the connected CRM into Nooks.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'POST', path: '/integrations/prospects/sync', body: {} },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
