import { declarativeRestConnector } from './declarative-rest.js'

const id = (description: string) => ({ type: 'string', description }) as const
const pageQuery = {
  limit: { type: 'integer', minimum: 1, maximum: 200 },
  cursor: { type: 'string' },
  sort: { type: 'string', enum: ['asc', 'desc'] },
  begin_time: { type: 'string', description: 'ISO 8601 lower timestamp bound.' },
  end_time: { type: 'string', description: 'ISO 8601 upper timestamp bound.' },
} as const

/**
 * Recurly API v3.
 *
 * The private API key is the HTTP Basic username with an empty password.
 * Recurly accepts either UUID resource ids or the documented `code-<value>`
 * form for account and plan identifiers, so callers can use stable business
 * codes without first resolving a UUID.
 */
export const recurlyConnector = declarativeRestConnector({
  kind: 'recurly',
  displayName: 'Recurly',
  description:
    'Manage Recurly billing accounts, plans, subscriptions, invoices, and subscription lifecycle state.',
  auth: {
    kind: 'api-key',
    hint: 'Recurly private API key from Developer Settings. Sent as the HTTP Basic username with an empty password.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://v3.recurly.com',
  credentialPlacement: { kind: 'basic-api-key' },
  defaultHeaders: {
    accept: 'application/vnd.recurly.v2021-02-25',
    'content-type': 'application/json',
  },
  test: { method: 'GET', path: '/sites', query: { limit: 1 } },
  capabilities: [
    {
      name: 'sites.list',
      class: 'read',
      description: 'List sites accessible to the supplied Recurly private API key.',
      parameters: { type: 'object', properties: { limit: pageQuery.limit } },
      request: { method: 'GET', path: '/sites', query: { limit: '{limit}' } },
    },
    {
      name: 'accounts.list',
      class: 'read',
      description: 'List billing accounts with optional lifecycle and time filters.',
      parameters: {
        type: 'object',
        properties: {
          ...pageQuery,
          state: { type: 'string', enum: ['active', 'closed', 'any'] },
          email: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/accounts',
        query: {
          limit: '{limit}',
          cursor: '{cursor}',
          sort: '{sort}',
          begin_time: '{begin_time}',
          end_time: '{end_time}',
          state: '{state}',
          email: '{email}',
        },
      },
    },
    {
      name: 'accounts.get',
      class: 'read',
      description: 'Read one billing account by UUID or code-prefixed identifier.',
      parameters: {
        type: 'object',
        properties: { accountId: id('Account UUID or `code-<account code>`.') },
        required: ['accountId'],
      },
      request: { method: 'GET', path: '/accounts/{accountId}' },
    },
    {
      name: 'accounts.create',
      class: 'mutation',
      description: 'Create a billing account.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          email: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company: { type: 'string' },
          preferred_locale: { type: 'string' },
          preferred_time_zone: { type: 'string' },
          address: { type: 'object' },
          custom_fields: { type: 'array', items: { type: 'object' } },
        },
        required: ['code', 'email'],
      },
      request: { method: 'POST', path: '/accounts', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'accounts.update',
      class: 'mutation',
      description: 'Update profile, address, locale, or custom fields on a billing account.',
      parameters: {
        type: 'object',
        properties: {
          accountId: id('Account UUID or `code-<account code>`.'),
          email: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company: { type: 'string' },
          preferred_locale: { type: 'string' },
          preferred_time_zone: { type: 'string' },
          address: { type: 'object' },
          custom_fields: { type: 'array', items: { type: 'object' } },
        },
        required: ['accountId'],
      },
      request: { method: 'PUT', path: '/accounts/{accountId}', body: 'args' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'plans.list',
      class: 'read',
      description: 'List subscription plans.',
      parameters: {
        type: 'object',
        properties: { ...pageQuery, state: { type: 'string', enum: ['active', 'inactive'] } },
      },
      request: {
        method: 'GET',
        path: '/plans',
        query: {
          limit: '{limit}', cursor: '{cursor}', sort: '{sort}',
          begin_time: '{begin_time}', end_time: '{end_time}', state: '{state}',
        },
      },
    },
    {
      name: 'subscriptions.list',
      class: 'read',
      description: 'List subscriptions across the site.',
      parameters: {
        type: 'object',
        properties: {
          ...pageQuery,
          state: { type: 'string', enum: ['active', 'canceled', 'expired', 'failed', 'future', 'paused'] },
        },
      },
      request: {
        method: 'GET',
        path: '/subscriptions',
        query: {
          limit: '{limit}', cursor: '{cursor}', sort: '{sort}',
          begin_time: '{begin_time}', end_time: '{end_time}',
          state: '{state}',
        },
      },
    },
    {
      name: 'accounts.subscriptions.list',
      class: 'read',
      description: 'List subscriptions belonging to one billing account.',
      parameters: {
        type: 'object',
        properties: {
          ...pageQuery,
          accountId: id('Account UUID or `code-<account code>`.'),
          state: { type: 'string', enum: ['active', 'canceled', 'expired', 'failed', 'future', 'paused'] },
        },
        required: ['accountId'],
      },
      request: {
        method: 'GET',
        path: '/accounts/{accountId}/subscriptions',
        query: {
          limit: '{limit}', cursor: '{cursor}', sort: '{sort}',
          begin_time: '{begin_time}', end_time: '{end_time}', state: '{state}',
        },
      },
    },
    {
      name: 'subscriptions.get',
      class: 'read',
      description: 'Read one subscription by UUID.',
      parameters: {
        type: 'object',
        properties: { subscriptionId: id('Subscription UUID.') },
        required: ['subscriptionId'],
      },
      request: { method: 'GET', path: '/subscriptions/{subscriptionId}' },
    },
    {
      name: 'subscriptions.create',
      class: 'mutation',
      description: 'Start a subscription for an existing or inline billing account.',
      parameters: {
        type: 'object',
        properties: {
          plan_code: { type: 'string' },
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          account: { type: 'object', description: 'Existing account reference or inline account object.' },
          quantity: { type: 'integer', minimum: 1 },
          starts_at: { type: 'string' },
          trial_ends_at: { type: 'string' },
          collection_method: { type: 'string', enum: ['automatic', 'manual'] },
          net_terms: { type: 'integer', minimum: 0 },
          custom_fields: { type: 'array', items: { type: 'object' } },
        },
        required: ['plan_code', 'currency', 'account'],
      },
      request: { method: 'POST', path: '/subscriptions', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscriptions.cancel',
      class: 'mutation',
      description: 'Schedule a subscription to cancel at its renewal date.',
      parameters: {
        type: 'object',
        properties: { subscriptionId: id('Subscription UUID.') },
        required: ['subscriptionId'],
      },
      request: { method: 'POST', path: '/subscriptions/{subscriptionId}/cancel', body: {} },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscriptions.reactivate',
      class: 'mutation',
      description: 'Reactivate a subscription that is pending cancellation.',
      parameters: {
        type: 'object',
        properties: { subscriptionId: id('Subscription UUID.') },
        required: ['subscriptionId'],
      },
      request: { method: 'POST', path: '/subscriptions/{subscriptionId}/reactivate', body: {} },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'subscriptions.terminate',
      class: 'mutation',
      description: 'Immediately terminate a subscription, with an explicit refund policy.',
      parameters: {
        type: 'object',
        properties: {
          subscriptionId: id('Subscription UUID.'),
          refund: { type: 'string', enum: ['none', 'partial', 'full'] },
        },
        required: ['subscriptionId', 'refund'],
      },
      request: {
        method: 'POST',
        path: '/subscriptions/{subscriptionId}/terminate',
        query: { refund: '{refund}' },
        body: {},
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'invoices.list',
      class: 'read',
      description: 'List invoices with account, state, type, and time filters.',
      parameters: {
        type: 'object',
        properties: {
          ...pageQuery,
          accountId: id('Optional account UUID or `code-<account code>`.'),
          state: { type: 'string', enum: ['pending', 'processing', 'past_due', 'paid', 'failed', 'voided'] },
          type: { type: 'string', enum: ['charge', 'credit', 'non-legacy'] },
        },
      },
      request: {
        method: 'GET',
        path: '/invoices',
        query: {
          limit: '{limit}', cursor: '{cursor}', sort: '{sort}',
          begin_time: '{begin_time}', end_time: '{end_time}',
          account_id: '{accountId}', state: '{state}', type: '{type}',
        },
      },
    },
    {
      name: 'invoices.get',
      class: 'read',
      description: 'Read one invoice by UUID or number-prefixed identifier.',
      parameters: {
        type: 'object',
        properties: { invoiceId: id('Invoice UUID or `number-<invoice number>`.') },
        required: ['invoiceId'],
      },
      request: { method: 'GET', path: '/invoices/{invoiceId}' },
    },
    {
      name: 'accounts.invoices.list',
      class: 'read',
      description: 'List invoices belonging to one billing account.',
      parameters: {
        type: 'object',
        properties: {
          ...pageQuery,
          accountId: id('Account UUID or `code-<account code>`.'),
          state: { type: 'string', enum: ['pending', 'processing', 'past_due', 'paid', 'failed', 'voided'] },
          type: { type: 'string', enum: ['charge', 'credit', 'non-legacy'] },
        },
        required: ['accountId'],
      },
      request: {
        method: 'GET',
        path: '/accounts/{accountId}/invoices',
        query: {
          limit: '{limit}', cursor: '{cursor}', sort: '{sort}',
          begin_time: '{begin_time}', end_time: '{end_time}',
          state: '{state}', type: '{type}',
        },
      },
    },
  ],
})
