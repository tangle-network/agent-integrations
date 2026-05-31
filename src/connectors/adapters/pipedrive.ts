import { declarativeRestConnector } from './declarative-rest.js'

// Pipedrive OAuth issues a per-account `api_domain` in the token response
// (e.g. https://acme-sandbox.pipedrive.com). Persist it as metadata.apiDomain on the
// connection; fall back to the shared host when missing for compatibility with
// pre-migration tokens issued before that field was captured.
export const pipedriveConnector = declarativeRestConnector({
  kind: 'pipedrive',
  displayName: 'Pipedrive',
  description: 'Search and update Pipedrive deals, persons, and organizations.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://oauth.pipedrive.com/oauth/authorize',
    tokenUrl: 'https://oauth.pipedrive.com/oauth/token',
    scopes: ['deals:full', 'contacts:full', 'leads:full', 'activities:full'],
    clientIdEnv: 'PIPEDRIVE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'PIPEDRIVE_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiDomain', fallback: 'https://api.pipedrive.com' },
  test: { method: 'GET', path: '/v1/users/me' },
  capabilities: [
    {
      name: 'deals.search',
      class: 'read',
      description: 'Search Pipedrive deals by free-text term.',
      parameters: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          fields: { type: 'string' },
          status: { type: 'string', enum: ['open', 'won', 'lost'] },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
        },
        required: ['term'],
      },
      request: {
        method: 'GET',
        path: '/v1/deals/search',
        query: { term: '{term}', fields: '{fields}', status: '{status}', limit: '{limit}' },
      },
      requiredScopes: ['deals:full'],
    },
    {
      name: 'deals.get',
      class: 'read',
      description: 'Read a single Pipedrive deal by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/v1/deals/{id}' },
      requiredScopes: ['deals:full'],
    },
    {
      name: 'deals.create',
      class: 'mutation',
      description: 'Create a Pipedrive deal.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          value: { type: 'number' },
          currency: { type: 'string' },
          person_id: { type: 'integer' },
          org_id: { type: 'integer' },
          stage_id: { type: 'integer' },
          status: { type: 'string', enum: ['open', 'won', 'lost'] },
        },
        required: ['title'],
      },
      request: { method: 'POST', path: '/v1/deals', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['deals:full'],
    },
    {
      name: 'deals.update',
      class: 'mutation',
      description: 'Update a Pipedrive deal.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          fields: { type: 'object' },
        },
        required: ['id', 'fields'],
      },
      request: { method: 'PUT', path: '/v1/deals/{id}', body: '{fields}' },
      cas: 'optimistic-read-verify',
      requiredScopes: ['deals:full'],
    },
    {
      name: 'persons.search',
      class: 'read',
      description: 'Search Pipedrive persons by free-text term.',
      parameters: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          fields: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
        },
        required: ['term'],
      },
      request: {
        method: 'GET',
        path: '/v1/persons/search',
        query: { term: '{term}', fields: '{fields}', limit: '{limit}' },
      },
      requiredScopes: ['contacts:full'],
    },
    {
      name: 'persons.create',
      class: 'mutation',
      description: 'Create a Pipedrive person.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'array', items: { type: 'object' } },
          phone: { type: 'array', items: { type: 'object' } },
          org_id: { type: 'integer' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/v1/persons', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['contacts:full'],
    },
    {
      name: 'organizations.search',
      class: 'read',
      description: 'Search Pipedrive organizations by free-text term.',
      parameters: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          fields: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
        },
        required: ['term'],
      },
      request: {
        method: 'GET',
        path: '/v1/organizations/search',
        query: { term: '{term}', fields: '{fields}', limit: '{limit}' },
      },
      requiredScopes: ['contacts:full'],
    },
    {
      name: 'organizations.create',
      class: 'mutation',
      description: 'Create a Pipedrive organization.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          owner_id: { type: 'integer' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/v1/organizations', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['contacts:full'],
    },
  ],
})
