import { declarativeRestConnector } from './declarative-rest.js'

export const baremetricsConnector = declarativeRestConnector({
  kind: 'baremetrics',
  displayName: 'Baremetrics',
  description:
    'Create and update customers, plans, and subscriptions in Baremetrics, the analytics and metrics platform for subscription businesses.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://baremetrics.com/oauth/authorize',
    tokenUrl: 'https://api.baremetrics.com/v1/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnv: 'BAREMETRICS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'BAREMETRICS_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.baremetrics.com/v1',
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'create.customer',
      class: 'mutation',
      description:
        'Create a customer under a Baremetrics source. Pass `body` matching the Baremetrics customers payload (oid, name, email, notes, current_plan_oid, etc.).',
      parameters: {
        type: 'object',
        properties: {
          sourceId: {
            type: 'string',
            description: 'Baremetrics source id (e.g. the connected Stripe/Recurly/Chargify source).',
          },
          body: {
            type: 'object',
            description:
              'Baremetrics customer payload: { oid, name?, email?, notes?, current_plan_oid? }.',
          },
        },
        required: ['sourceId', 'body'],
      },
      request: {
        method: 'POST',
        path: '/{sourceId}/customers',
        body: '{body}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
      externalEffect: true,
    },
    {
      name: 'create.plan',
      class: 'mutation',
      description:
        'Create a plan under a Baremetrics source. Pass `body` matching the Baremetrics plans payload (oid, name, currency, amounts, interval, interval_count, etc.).',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Baremetrics source id.' },
          body: {
            type: 'object',
            description:
              'Baremetrics plan payload: { oid, name, currency, amount, interval, interval_count, trial_days? }.',
          },
        },
        required: ['sourceId', 'body'],
      },
      request: {
        method: 'POST',
        path: '/{sourceId}/plans',
        body: '{body}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
      externalEffect: true,
    },
    {
      name: 'create.subscription',
      class: 'mutation',
      description:
        'Create a subscription under a Baremetrics source. Pass `body` matching the Baremetrics subscriptions payload (oid, started_at, customer_oid, plan_oid, etc.).',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Baremetrics source id.' },
          body: {
            type: 'object',
            description:
              'Baremetrics subscription payload: { oid, started_at, customer_oid, plan_oid, canceled_at? }.',
          },
        },
        required: ['sourceId', 'body'],
      },
      request: {
        method: 'POST',
        path: '/{sourceId}/subscriptions',
        body: '{body}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
      externalEffect: true,
    },
    {
      name: 'update.customer',
      class: 'mutation',
      description:
        'Update an existing Baremetrics customer (identified by its oid) under a given source. Pass `body` with the updatable fields per the Baremetrics customers update payload.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Baremetrics source id.' },
          customerOid: {
            type: 'string',
            description: 'External id of the customer to update (the oid value previously created).',
          },
          body: {
            type: 'object',
            description:
              'Baremetrics customer update payload: { name?, email?, notes?, current_plan_oid? }.',
          },
        },
        required: ['sourceId', 'customerOid', 'body'],
      },
      request: {
        method: 'PUT',
        path: '/{sourceId}/customers/{customerOid}',
        body: '{body}',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write'],
      externalEffect: true,
    },
  ],
})
