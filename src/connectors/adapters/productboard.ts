import { declarativeRestConnector } from './declarative-rest.js'

export const productboardConnector = declarativeRestConnector({
  kind: 'productboard',
  displayName: 'Productboard',
  description: 'Manage features and capture product feedback with Productboard.',
  auth: { kind: 'api-key', hint: 'Productboard API token.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.productboard.com/v1',
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'features.create',
      class: 'mutation',
      description: 'Create a new feature.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          parentType: { type: 'string' },
          parentId: { type: 'string' },
          type: { type: 'string' },
          archived: { type: 'boolean' },
        },
        required: ['name', 'description', 'parentType', 'parentId', 'type'],
      },
      request: {
        method: 'POST',
        path: '/features',
        body: {
          name: '{name}',
          description: '{description}',
          parentType: '{parentType}',
          parentId: '{parentId}',
          type: '{type}',
          archived: '{archived}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'features.update',
      class: 'mutation',
      description: 'Update an existing feature.',
      parameters: {
        type: 'object',
        properties: {
          featureId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          archived: { type: 'boolean' },
        },
        required: ['featureId'],
      },
      request: {
        method: 'PUT',
        path: '/features/{featureId}',
        body: {
          name: '{name}',
          description: '{description}',
          archived: '{archived}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'features.get',
      class: 'read',
      description: 'Retrieve a feature by ID.',
      parameters: {
        type: 'object',
        properties: { featureId: { type: 'string' } },
        required: ['featureId'],
      },
      request: { method: 'GET', path: '/features/{featureId}' },
    },
    {
      name: 'features.list',
      class: 'read',
      description: 'List features.',
      parameters: {
        type: 'object',
        properties: {
          archived: { type: 'boolean' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/features',
        query: { archived: '{archived}', limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'notes.create',
      class: 'mutation',
      description: 'Create a feedback note.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          userEmail: { type: 'string' },
          companyDomain: { type: 'string' },
          displayUrl: { type: 'string' },
          sourceOrigin: { type: 'string' },
          sourceRecordId: { type: 'string' },
          tags: { type: 'object' },
        },
        required: ['title', 'content'],
      },
      request: {
        method: 'POST',
        path: '/notes',
        body: {
          title: '{title}',
          content: '{content}',
          userEmail: '{userEmail}',
          companyDomain: '{companyDomain}',
          displayUrl: '{displayUrl}',
          sourceOrigin: '{sourceOrigin}',
          sourceRecordId: '{sourceRecordId}',
          tags: '{tags}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'notes.get',
      class: 'read',
      description: 'Retrieve a note by ID.',
      parameters: {
        type: 'object',
        properties: { noteId: { type: 'string' } },
        required: ['noteId'],
      },
      request: { method: 'GET', path: '/notes/{noteId}' },
    },
    {
      name: 'notes.list',
      class: 'read',
      description: 'List feedback notes.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/notes',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
  ],
})
