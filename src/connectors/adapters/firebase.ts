import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Firebase / Cloud Firestore adapter.
 *
 * Surfaces Firestore document CRUD via the public REST API
 * (https://firestore.googleapis.com/v1) using Google OAuth2 with the
 * `datastore` scope, which Google Identity grants for Firestore + Datastore.
 *
 * Path parameter `documentPath` is the trailing portion after
 * `databases/(default)/documents/` (e.g. `users/abc` or `orders/123/items/9`)
 * so callers stay aware of Firestore's collection/document alternation rule.
 *
 * `body` for create/patch is a raw Firestore `Document` object — the caller
 * supplies `fields` already typed via Firestore Value union (stringValue,
 * integerValue, etc.). This adapter intentionally does not auto-convert
 * primitives; callers using this from agent workflows pass the typed JSON
 * directly so we never silently re-encode user data.
 */
export const firebaseConnector = declarativeRestConnector({
  kind: 'firebase',
  displayName: 'Firebase',
  description: 'Read and write Cloud Firestore documents via the Firebase REST API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/datastore',
      'https://www.googleapis.com/auth/firebase',
    ],
    clientIdEnv: 'FIREBASE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FIREBASE_OAUTH_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://firestore.googleapis.com',
  test: { method: 'GET', path: '/v1/projects/{projectId}/databases/(default)/documents' },
  capabilities: [
    {
      name: 'documents.list',
      class: 'read',
      description: 'List documents in a Firestore collection.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          collectionPath: { type: 'string', description: 'Collection path under documents/, e.g. "users" or "orders/123/items".' },
          pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
          pageToken: { type: 'string' },
        },
        required: ['projectId', 'collectionPath'],
      },
      request: {
        method: 'GET',
        path: '/v1/projects/{projectId}/databases/(default)/documents/{collectionPath}',
        query: { pageSize: '{pageSize}', pageToken: '{pageToken}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/datastore'],
    },
    {
      name: 'documents.get',
      class: 'read',
      description: 'Read a single Firestore document.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          documentPath: { type: 'string', description: 'Document path under documents/, e.g. "users/abc".' },
        },
        required: ['projectId', 'documentPath'],
      },
      request: {
        method: 'GET',
        path: '/v1/projects/{projectId}/databases/(default)/documents/{documentPath}',
      },
      requiredScopes: ['https://www.googleapis.com/auth/datastore'],
    },
    {
      name: 'documents.runQuery',
      class: 'read',
      description: 'Run a structured Firestore query (StructuredQuery RPC).',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          parent: { type: 'string', description: 'Parent path under documents/, "" for root.' },
          structuredQuery: { type: 'object' },
        },
        required: ['projectId', 'structuredQuery'],
      },
      request: {
        method: 'POST',
        path: '/v1/projects/{projectId}/databases/(default)/documents/{parent}:runQuery',
        body: { structuredQuery: '{structuredQuery}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/datastore'],
    },
    {
      name: 'documents.create',
      class: 'mutation',
      description: 'Create a Firestore document. `documentId` is optional; omit to let Firestore assign.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          collectionPath: { type: 'string' },
          documentId: { type: 'string' },
          fields: { type: 'object', description: 'Firestore-typed field map, e.g. { name: { stringValue: "Ada" } }.' },
        },
        required: ['projectId', 'collectionPath', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/v1/projects/{projectId}/databases/(default)/documents/{collectionPath}',
        query: { documentId: '{documentId}' },
        body: { fields: '{fields}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/datastore'],
    },
    {
      name: 'documents.patch',
      class: 'mutation',
      description: 'Update or upsert a Firestore document via PATCH.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          documentPath: { type: 'string' },
          fields: { type: 'object' },
          updateMaskFieldPaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Field paths to update; omit to replace the whole document.',
          },
        },
        required: ['projectId', 'documentPath', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/projects/{projectId}/databases/(default)/documents/{documentPath}',
        query: { 'updateMask.fieldPaths': '{updateMaskFieldPaths}' },
        body: { fields: '{fields}' },
      },
      cas: 'etag-if-match',
      requiredScopes: ['https://www.googleapis.com/auth/datastore'],
    },
    {
      name: 'documents.delete',
      class: 'mutation',
      description: 'Delete a Firestore document.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          documentPath: { type: 'string' },
        },
        required: ['projectId', 'documentPath'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/projects/{projectId}/databases/(default)/documents/{documentPath}',
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/datastore'],
    },
  ],
})
