import { declarativeRestConnector } from './declarative-rest.js'

export const certopusConnector = declarativeRestConnector({
  kind: 'certopus',
  displayName: 'Certopus',
  description: 'Issue and manage Certopus digital certificates for events and categories.',
  auth: { kind: 'api-key', hint: 'Certopus API key from the workspace integrations panel.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.certopus.com/v1',
  test: { method: 'GET', path: '/organisations' },
  capabilities: [
    {
      name: 'organisations.list',
      class: 'read',
      description: 'List organisations the authenticated key has access to.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/organisations' },
    },
    {
      name: 'events.list',
      class: 'read',
      description: 'List events under an organisation.',
      parameters: {
        type: 'object',
        properties: { organisation: { type: 'string' } },
        required: ['organisation'],
      },
      request: {
        method: 'GET',
        path: '/events',
        query: { organisation: '{organisation}' },
      },
    },
    {
      name: 'categories.list',
      class: 'read',
      description: 'List categories under an event.',
      parameters: {
        type: 'object',
        properties: { organisation: { type: 'string' }, event: { type: 'string' } },
        required: ['organisation', 'event'],
      },
      request: {
        method: 'GET',
        path: '/categories',
        query: { organisation: '{organisation}', event: '{event}' },
      },
    },
    {
      name: 'credentials.create',
      class: 'mutation',
      description:
        'Create a credential (certificate) for a recipient inside an event/category, with optional auto-generate and auto-publish.',
      parameters: {
        type: 'object',
        properties: {
          organisation: { type: 'string' },
          event: { type: 'string' },
          category: { type: 'string' },
          email: { type: 'string' },
          fields: { type: 'object' },
          generate: { type: 'boolean' },
          publish: { type: 'boolean' },
        },
        required: ['organisation', 'event', 'category', 'email', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/credentials',
        body: {
          organisation: '{organisation}',
          event: '{event}',
          category: '{category}',
          email: '{email}',
          fields: '{fields}',
          generate: '{generate}',
          publish: '{publish}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'credentials.revoke',
      class: 'mutation',
      description: 'Revoke a previously issued Certopus credential by id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Credential identifier.' },
        },
        required: ['id'],
      },
      request: {
        method: 'DELETE',
        path: '/credentials/{id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'credentials.update',
      class: 'mutation',
      description: 'Update metadata (fields, generate, publish) on an existing credential.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Credential identifier.' },
          fields: { type: 'object' },
          generate: { type: 'boolean' },
          publish: { type: 'boolean' },
        },
        required: ['id'],
      },
      request: {
        method: 'PATCH',
        path: '/credentials/{id}',
        body: {
          fields: '{fields}',
          generate: '{generate}',
          publish: '{publish}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'events.create',
      class: 'mutation',
      description: 'Create a credential event under an organisation.',
      parameters: {
        type: 'object',
        properties: {
          organisation: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          startDate: { type: 'string', description: 'ISO start date.' },
          endDate: { type: 'string', description: 'ISO end date.' },
        },
        required: ['organisation', 'title'],
      },
      request: {
        method: 'POST',
        path: '/events',
        body: {
          organisation: '{organisation}',
          title: '{title}',
          description: '{description}',
          startDate: '{startDate}',
          endDate: '{endDate}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
