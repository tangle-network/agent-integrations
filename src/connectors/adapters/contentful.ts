/**
 * @stable Contentful CMS connector — read and write entries through the
 * Content Management API (CMA).
 *
 * Five capabilities, all scoped to a single `spaceId` + `environmentId`
 * (callers pin the environment per-action so the same connection can target
 * `master`, `staging`, etc. without re-auth):
 *
 *   entries.list(spaceId, environmentId, contentType?, query?, limit?, skip?)
 *     → CMA entry collection envelope
 *     Read. GET /spaces/{spaceId}/environments/{environmentId}/entries.
 *
 *   entries.get(spaceId, environmentId, entryId)
 *     → CMA entry shape
 *     Read. GET /spaces/{spaceId}/environments/{environmentId}/entries/{entryId}.
 *
 *   entries.create(spaceId, environmentId, contentType, fields)
 *     → created CMA entry
 *     Mutation. POST /spaces/{spaceId}/environments/{environmentId}/entries with
 *     the `X-Contentful-Content-Type` header.
 *
 *   entries.update(spaceId, environmentId, entryId, version, fields)
 *     → updated CMA entry
 *     Mutation with CAS. PUT /spaces/{spaceId}/environments/{environmentId}/entries/{entryId}
 *     with `X-Contentful-Version` set from the caller-supplied `version` so
 *     concurrent edits surface as 409 conflict.
 *
 *   entries.publish(spaceId, environmentId, entryId, version)
 *     → published entry
 *     Mutation with CAS. PUT /spaces/{spaceId}/environments/{environmentId}/entries/{entryId}/published.
 *
 * Auth: OAuth2 (Contentful OAuth app + Bearer token). Scopes:
 *   - `content_management_read` for read capabilities
 *   - `content_management_manage` for write capabilities
 *
 * Versioning: Contentful does not emit HTTP ETag headers. Every entry body
 * carries `sys.version`; callers thread it back as the `version` argument on
 * mutations. The 409 surfaces through the shared declarative-rest helper as
 * a `{ status: 'conflict', ... }` result row.
 */

import { declarativeRestConnector } from './declarative-rest.js'

const CMA_CONTENT_TYPE = 'application/vnd.contentful.management.v1+json'

const entryLocator = {
  spaceId: { type: 'string', description: 'Contentful space ID.' },
  environmentId: { type: 'string', description: 'Contentful environment ID, e.g. "master".' },
} as const

export const contentfulConnector = declarativeRestConnector({
  kind: 'contentful',
  displayName: 'Contentful',
  description:
    'Read, create, update, and publish Contentful entries through the Content Management API for a given space and environment.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://be.contentful.com/oauth/authorize',
    tokenUrl: 'https://be.contentful.com/oauth/token',
    scopes: ['content_management_read', 'content_management_manage'],
    clientIdEnv: 'CONTENTFUL_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CONTENTFUL_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.contentful.com',
  defaultHeaders: {
    'content-type': CMA_CONTENT_TYPE,
  },
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'entries.list',
      class: 'read',
      description: 'List entries in a Contentful environment, optionally filtered by content type and a CMA query string.',
      parameters: {
        type: 'object',
        properties: {
          ...entryLocator,
          contentType: { type: 'string', description: 'Restrict the listing to a single content type ID.' },
          query: { type: 'string', description: 'Full-text query passed as the CMA `query` parameter.' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          skip: { type: 'integer', minimum: 0 },
        },
        required: ['spaceId', 'environmentId'],
      },
      request: {
        method: 'GET',
        path: '/spaces/{spaceId}/environments/{environmentId}/entries',
        query: {
          content_type: '{contentType}',
          query: '{query}',
          limit: '{limit}',
          skip: '{skip}',
        },
      },
      requiredScopes: ['content_management_read'],
    },
    {
      name: 'entries.get',
      class: 'read',
      description: 'Fetch a single Contentful entry by ID.',
      parameters: {
        type: 'object',
        properties: {
          ...entryLocator,
          entryId: { type: 'string' },
        },
        required: ['spaceId', 'environmentId', 'entryId'],
      },
      request: {
        method: 'GET',
        path: '/spaces/{spaceId}/environments/{environmentId}/entries/{entryId}',
      },
      requiredScopes: ['content_management_read'],
    },
    {
      name: 'entries.create',
      class: 'mutation',
      description: 'Create a draft entry of the given content type. The `fields` map mirrors the CMA `fields` body field (locale-keyed values).',
      parameters: {
        type: 'object',
        properties: {
          ...entryLocator,
          contentType: { type: 'string', description: 'Content type ID; sent via the X-Contentful-Content-Type header.' },
          fields: {
            type: 'object',
            description: 'Locale-keyed field values, e.g. `{ title: { "en-US": "Hello" } }`.',
            additionalProperties: true,
          },
        },
        required: ['spaceId', 'environmentId', 'contentType', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/spaces/{spaceId}/environments/{environmentId}/entries',
        headers: {
          'x-contentful-content-type': '{contentType}',
        },
        body: { fields: '{fields}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['content_management_manage'],
    },
    {
      name: 'entries.update',
      class: 'mutation',
      description: 'Update an existing entry. `version` must be the current `sys.version` from a prior read; mismatched versions return 409.',
      parameters: {
        type: 'object',
        properties: {
          ...entryLocator,
          entryId: { type: 'string' },
          version: { type: 'integer', description: 'Current sys.version of the entry.' },
          fields: {
            type: 'object',
            description: 'Replacement locale-keyed field values.',
            additionalProperties: true,
          },
        },
        required: ['spaceId', 'environmentId', 'entryId', 'version', 'fields'],
      },
      request: {
        method: 'PUT',
        path: '/spaces/{spaceId}/environments/{environmentId}/entries/{entryId}',
        headers: {
          'x-contentful-version': '{version}',
        },
        body: { fields: '{fields}' },
      },
      cas: 'etag-if-match',
      externalEffect: true,
      requiredScopes: ['content_management_manage'],
    },
    {
      name: 'entries.publish',
      class: 'mutation',
      description: 'Publish an entry. `version` must be the current `sys.version`; mismatched versions return 409.',
      parameters: {
        type: 'object',
        properties: {
          ...entryLocator,
          entryId: { type: 'string' },
          version: { type: 'integer', description: 'Current sys.version of the entry.' },
        },
        required: ['spaceId', 'environmentId', 'entryId', 'version'],
      },
      request: {
        method: 'PUT',
        path: '/spaces/{spaceId}/environments/{environmentId}/entries/{entryId}/published',
        headers: {
          'x-contentful-version': '{version}',
        },
      },
      cas: 'etag-if-match',
      externalEffect: true,
      requiredScopes: ['content_management_manage'],
    },
    {
      name: 'entries.unpublish',
      class: 'mutation',
      description:
        'Unpublish an entry, reverting it to draft. `version` must be the current `sys.version`; mismatched versions return 409.',
      parameters: {
        type: 'object',
        properties: {
          ...entryLocator,
          entryId: { type: 'string' },
          version: { type: 'integer', description: 'Current sys.version of the entry.' },
        },
        required: ['spaceId', 'environmentId', 'entryId', 'version'],
      },
      request: {
        method: 'DELETE',
        path: '/spaces/{spaceId}/environments/{environmentId}/entries/{entryId}/published',
        headers: {
          'x-contentful-version': '{version}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['content_management_manage'],
    },
    {
      name: 'entries.delete',
      class: 'mutation',
      description:
        'Permanently delete an entry. The entry must already be unpublished; publishing state is enforced upstream.',
      parameters: {
        type: 'object',
        properties: {
          ...entryLocator,
          entryId: { type: 'string' },
        },
        required: ['spaceId', 'environmentId', 'entryId'],
      },
      request: {
        method: 'DELETE',
        path: '/spaces/{spaceId}/environments/{environmentId}/entries/{entryId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['content_management_manage'],
    },
  ],
})
