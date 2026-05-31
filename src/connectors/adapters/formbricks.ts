import { declarativeRestConnector } from './declarative-rest.js'

// Formbricks is a self-hostable survey platform. The activepieces piece auth
// requires the operator to configure BOTH an appUrl (the instance origin,
// e.g. https://app.formbricks.com or a self-hosted URL) and a per-environment
// API key. We mirror that shape: baseUrl is metadata-driven so each connector
// source can point at its own Formbricks deployment, and credentials are
// placed in the x-api-key header that Formbricks' Management API expects.
// Source metadata key `appUrl` matches the auth field exposed by the
// activepieces piece so the connector-provisioning UI maps 1:1.
export const formbricksConnector = declarativeRestConnector({
  kind: 'formbricks',
  displayName: 'Formbricks',
  description: 'Read and mutate Formbricks surveys, responses, and contacts on the configured environment.',
  auth: { kind: 'api-key', hint: 'Formbricks environment API key. Configure source metadata.appUrl with your instance origin.' },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'appUrl' },
  credentialPlacement: { kind: 'header', header: 'x-api-key' },
  // GET /api/v1/management/me is an authenticated probe that returns the
  // environment the API key belongs to without listing any survey data.
  test: { method: 'GET', path: '/api/v1/management/me' },
  capabilities: [
    {
      name: 'surveys.list',
      class: 'read',
      description: 'List surveys in the environment the API key belongs to.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          skip: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/management/surveys',
        query: { limit: '{limit}', skip: '{skip}' },
      },
    },
    {
      name: 'surveys.get',
      class: 'read',
      description: 'Fetch a single survey by id.',
      parameters: {
        type: 'object',
        properties: { surveyId: { type: 'string' } },
        required: ['surveyId'],
      },
      request: { method: 'GET', path: '/api/v1/management/surveys/{surveyId}' },
    },
    {
      name: 'responses.list',
      class: 'read',
      description: 'List responses, optionally filtered by survey id.',
      parameters: {
        type: 'object',
        properties: {
          surveyId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          skip: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/management/responses',
        query: { surveyId: '{surveyId}', limit: '{limit}', skip: '{skip}' },
      },
    },
    {
      name: 'responses.get',
      class: 'read',
      description: 'Fetch a single response by id.',
      parameters: {
        type: 'object',
        properties: { responseId: { type: 'string' } },
        required: ['responseId'],
      },
      request: { method: 'GET', path: '/api/v1/management/responses/{responseId}' },
    },
    {
      name: 'contacts.list',
      class: 'read',
      description: 'List contacts in the environment the API key belongs to.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          skip: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/management/contacts',
        query: { limit: '{limit}', skip: '{skip}' },
      },
    },
    {
      name: 'contacts.get',
      class: 'read',
      description: 'Fetch a single contact by id.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' } },
        required: ['contactId'],
      },
      request: { method: 'GET', path: '/api/v1/management/contacts/{contactId}' },
    },
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a contact with the supplied attributes payload.',
      parameters: {
        type: 'object',
        properties: { attributes: { type: 'object' } },
        required: ['attributes'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/management/contacts',
        body: { attributes: '{attributes}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update a contact identified by id with the supplied attributes payload.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          attributes: { type: 'object' },
        },
        required: ['contactId', 'attributes'],
      },
      request: {
        method: 'PUT',
        path: '/api/v1/management/contacts/{contactId}',
        body: { attributes: '{attributes}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete a contact by id.',
      parameters: {
        type: 'object',
        properties: { contactId: { type: 'string' } },
        required: ['contactId'],
      },
      request: { method: 'DELETE', path: '/api/v1/management/contacts/{contactId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'responses.delete',
      class: 'mutation',
      description: 'Delete a survey response by id.',
      parameters: {
        type: 'object',
        properties: { responseId: { type: 'string' } },
        required: ['responseId'],
      },
      request: { method: 'DELETE', path: '/api/v1/management/responses/{responseId}' },
      cas: 'native-idempotency',
    },
  ],
})
