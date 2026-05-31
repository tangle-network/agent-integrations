import { declarativeRestConnector } from './declarative-rest.js'

// Cognito Forms exposes a per-organization REST API rooted at
// https://www.cognitoforms.com/api. Authentication is an API key provided
// via the Authorization: Bearer <key> header (configured on the API key
// auth shape in the declarative-rest layer).
export const cognitoFormsConnector = declarativeRestConnector({
  kind: 'cognito-forms',
  displayName: 'Cognito Forms',
  description:
    'Create, read, update, and delete entries in Cognito Forms — an online form builder for collecting structured submissions.',
  auth: {
    kind: 'api-key',
    hint: 'Cognito Forms API key from Settings → Integrations → API. Sent as a Bearer token.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://www.cognitoforms.com/api',
  test: { method: 'GET', path: '/forms' },
  capabilities: [
    {
      name: 'entries.create',
      class: 'mutation',
      description: 'Create a new entry on the specified Cognito Forms form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          entry: { type: 'object' },
        },
        required: ['formId', 'entry'],
      },
      request: {
        method: 'POST',
        path: '/forms/{formId}/entries',
        body: '{entry}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'entries.update',
      class: 'mutation',
      description: 'Update an existing entry on a Cognito Forms form by entry id.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          entryId: { type: 'string' },
          entry: { type: 'object' },
        },
        required: ['formId', 'entryId', 'entry'],
      },
      request: {
        method: 'PUT',
        path: '/forms/{formId}/entries/{entryId}',
        body: '{entry}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'entries.delete',
      class: 'mutation',
      description: 'Delete an existing entry on a Cognito Forms form by entry id.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          entryId: { type: 'string' },
        },
        required: ['formId', 'entryId'],
      },
      request: {
        method: 'DELETE',
        path: '/forms/{formId}/entries/{entryId}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'entries.get',
      class: 'read',
      description: 'Read a single Cognito Forms entry by id.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          entryId: { type: 'string' },
        },
        required: ['formId', 'entryId'],
      },
      request: {
        method: 'GET',
        path: '/forms/{formId}/entries/{entryId}',
      },
    },
  ],
})
