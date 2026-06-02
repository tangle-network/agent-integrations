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
    {
      name: 'delete.customer',
      class: 'mutation',
      description:
        'Delete a Baremetrics customer (identified by its oid) from a given source. Permanently removes customer history from Baremetrics analytics.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Baremetrics source id.' },
          customerOid: {
            type: 'string',
            description: 'External id of the customer to delete.',
          },
        },
        required: ['sourceId', 'customerOid'],
      },
      request: {
        method: 'DELETE',
        path: '/{sourceId}/customers/{customerOid}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
      externalEffect: true,
    },
    {
      name: 'cancel.subscription',
      class: 'mutation',
      description:
        'Cancel a Baremetrics subscription (identified by its oid) under a given source. Marks the subscription as canceled in Baremetrics.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Baremetrics source id.' },
          subscriptionOid: {
            type: 'string',
            description: 'External id of the subscription to cancel.',
          },
        },
        required: ['sourceId', 'subscriptionOid'],
      },
      request: {
        method: 'DELETE',
        path: '/{sourceId}/subscriptions/{subscriptionOid}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
      externalEffect: true,
    },
    {
      name: 'delete.plan',
      class: 'mutation',
      description:
        'Delete a Baremetrics plan definition (identified by its oid) under a given source.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string', description: 'Baremetrics source id.' },
          planOid: {
            type: 'string',
            description: 'External id of the plan to delete.',
          },
        },
        required: ['sourceId', 'planOid'],
      },
      request: {
        method: 'DELETE',
        path: '/{sourceId}/plans/{planOid}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
      externalEffect: true,
    },
    {
      name: 'create.annotation',
      class: 'mutation',
      description:
        'Create a chart annotation in Baremetrics. Annotations appear as labelled markers on time-series charts.',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            description: 'Metric the annotation should appear on (e.g. mrr, active_customers).',
          },
          title: { type: 'string', description: 'Short annotation title.' },
          description: { type: 'string', description: 'Optional longer annotation body.' },
          date: {
            type: 'string',
            description: 'Date of the annotation in YYYY-MM-DD format.',
          },
        },
        required: ['metric', 'title', 'date'],
      },
      request: {
        method: 'POST',
        path: '/annotations',
        body: {
          metric: '{metric}',
          title: '{title}',
          description: '{description}',
          date: '{date}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
      externalEffect: true,
    },
  ],
})
