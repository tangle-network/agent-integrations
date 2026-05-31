import { declarativeRestConnector } from './declarative-rest.js'

export const timeOpsConnector = declarativeRestConnector({
  kind: 'time-ops',
  displayName: 'TimeOps',
  description: 'Manage customers, projects, and time registrations in TimeOps.',
  auth: { kind: 'api-key', hint: 'TimeOps API key from account settings.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.timeops.io/api/v1',
  test: { method: 'GET', path: '/customers' },
  capabilities: [
    {
      name: 'customers.create',
      class: 'mutation',
      description: 'Create a new customer.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          vatNumber: { type: 'string' },
          defaultRate: { type: 'number' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/customers', body: { name: '{name}', vatNumber: '{vatNumber}', defaultRate: '{defaultRate}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'projects.create',
      class: 'mutation',
      description: 'Create a new project.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
          name: { type: 'string' },
          billable: { type: 'boolean' },
          rate: { type: 'number' },
          finishedAt: { type: 'string' },
        },
        required: ['customerId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/projects',
        body: { customerId: '{customerId}', name: '{name}', billable: '{billable}', rate: '{rate}', finishedAt: '{finishedAt}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'registrations.create',
      class: 'mutation',
      description: 'Create a time registration.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          startedAt: { type: 'string' },
          stoppedAt: { type: 'string' },
          projectId: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'object' },
        },
        required: ['userId', 'startedAt'],
      },
      request: {
        method: 'POST',
        path: '/registrations',
        body: {
          userId: '{userId}',
          startedAt: '{startedAt}',
          stoppedAt: '{stoppedAt}',
          projectId: '{projectId}',
          description: '{description}',
          tags: '{tags}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'timers.start',
      class: 'mutation',
      description: 'Start a timer.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          projectId: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['userId'],
      },
      request: {
        method: 'POST',
        path: '/timers/start',
        body: { userId: '{userId}', projectId: '{projectId}', description: '{description}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'timers.stop',
      class: 'mutation',
      description: 'Stop a timer.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
        },
        required: ['userId'],
      },
      request: { method: 'POST', path: '/timers/stop', body: { userId: '{userId}' } },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'customers.list',
      class: 'read',
      description: 'List all customers.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/customers' },
    },
    {
      name: 'projects.list',
      class: 'read',
      description: 'List projects.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/projects', query: { customerId: '{customerId}' } },
    },
    {
      name: 'registrations.list',
      class: 'read',
      description: 'List time registrations.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          projectId: { type: 'string' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/registrations', query: { userId: '{userId}', projectId: '{projectId}' } },
    },
  ],
})
