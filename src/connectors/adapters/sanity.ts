/**
 * @stable Sanity Content Lake connector — query and mutate documents in a
 * Sanity dataset through the public HTTP API.
 *
 * Five capabilities, scoped per-dataset (the connection holds the project
 * host; the dataset is per-action so the same connection can target
 * `production`, `staging`, etc.):
 *
 *   documents.query(dataset, query, params?, apiVersion?)
 *     → { ms, query, result }
 *     Read. GET /v{apiVersion}/data/query/{dataset}?query={GROQ}&%24<param>=…
 *     The Sanity HTTP query API serializes GROQ params as `$<name>` query
 *     keys with JSON-encoded values.
 *
 *   documents.get(dataset, documentId, apiVersion?)
 *     → { ms, documents: [doc] }
 *     Read. GET /v{apiVersion}/data/doc/{dataset}/{documentId}.
 *
 *   documents.create(dataset, document, apiVersion?)
 *     → { transactionId, results: [...] }
 *     Mutation. POST /v{apiVersion}/data/mutate/{dataset} with a single
 *     `create` mutation. The caller passes the full document body including
 *     `_type` and optional `_id`. We thread `inv.idempotencyKey` as the
 *     `transactionId` query so retries collapse server-side.
 *
 *   documents.patch(dataset, documentId, patch, apiVersion?, ifRevisionId?)
 *     → { transactionId, results: [...] }
 *     Mutation with CAS. POST /v{apiVersion}/data/mutate/{dataset} with a
 *     single `patch` mutation. The caller threads `_rev` back as
 *     `ifRevisionId` so concurrent edits surface as 409.
 *
 *   documents.delete(dataset, documentId, apiVersion?)
 *     → { transactionId, results: [...] }
 *     Mutation. POST /v{apiVersion}/data/mutate/{dataset} with a single
 *     `delete` mutation.
 *
 * Auth: OAuth2 (Sanity Manage OAuth app + Bearer token). Scopes:
 *   - `read` for read capabilities
 *   - `write` for write capabilities
 *
 * Base URL: per-project hostname `https://<projectId>.api.sanity.io`,
 * persisted on the connection as `metadata.apiHost`. We do NOT default to
 * the org-wide `api.sanity.io` because that endpoint refuses data-API calls.
 *
 * Versioning: Sanity does not emit HTTP ETag headers on data routes. Every
 * document carries `_rev`; callers thread it back as the `ifRevisionId`
 * argument on `documents.patch` so the mutation rejects with a 409 when the
 * document has been edited since the read. The 409 surfaces through the
 * shared declarative-rest helper as a `{ status: 'conflict', ... }` data
 * row.
 */

import { declarativeRestConnector } from './declarative-rest.js'

const DEFAULT_API_VERSION = 'v2025-02-19'

const datasetLocator = {
  dataset: { type: 'string', description: 'Sanity dataset name, e.g. "production".' },
  apiVersion: {
    type: 'string',
    description: 'Sanity API version, dated yyyy-mm-dd with a leading "v" (defaults to v2025-02-19).',
    default: DEFAULT_API_VERSION,
  },
} as const

export const sanityConnector = declarativeRestConnector({
  kind: 'sanity',
  displayName: 'Sanity',
  description:
    'Query Sanity datasets with GROQ, fetch documents by ID, and create, patch, or delete documents through the Content Lake HTTP API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.sanity.io/v1/oauth/authorize',
    tokenUrl: 'https://api.sanity.io/v1/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnv: 'SANITY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SANITY_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiHost' },
  defaultHeaders: {
    'content-type': 'application/json',
  },
  test: { method: 'GET', path: '/v1/users/me' },
  capabilities: [
    {
      name: 'documents.query',
      class: 'read',
      description:
        'Run a GROQ query against a Sanity dataset. `params` is a flat record of GROQ parameters; each value is JSON-encoded and sent as a `$<name>` query parameter.',
      parameters: {
        type: 'object',
        properties: {
          ...datasetLocator,
          query: { type: 'string', description: 'GROQ query string.' },
          params: {
            type: 'object',
            description: 'GROQ parameter bindings. Each entry becomes a $name=<json> query parameter.',
            additionalProperties: true,
          },
        },
        required: ['dataset', 'query'],
      },
      request: {
        method: 'GET',
        path: '/{apiVersion}/data/query/{dataset}',
        query: {
          query: '{query}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'documents.get',
      class: 'read',
      description: 'Fetch a single Sanity document by ID from a dataset.',
      parameters: {
        type: 'object',
        properties: {
          ...datasetLocator,
          documentId: { type: 'string', description: 'Sanity document _id.' },
        },
        required: ['dataset', 'documentId'],
      },
      request: {
        method: 'GET',
        path: '/{apiVersion}/data/doc/{dataset}/{documentId}',
      },
      requiredScopes: ['read'],
    },
    {
      name: 'documents.create',
      class: 'mutation',
      description:
        'Create a Sanity document. `document` must include `_type` and may include `_id`. The connector wraps it in a single-mutation transaction and threads the invocation idempotency key as `transactionId` so retries collapse.',
      parameters: {
        type: 'object',
        properties: {
          ...datasetLocator,
          document: {
            type: 'object',
            description: 'Document body. Must include `_type`; `_id` is optional (auto-assigned otherwise).',
            additionalProperties: true,
          },
        },
        required: ['dataset', 'document'],
      },
      request: {
        method: 'POST',
        path: '/{apiVersion}/data/mutate/{dataset}',
        query: {
          returnIds: 'true',
          returnDocuments: 'true',
        },
        body: {
          mutations: [{ create: '{document}' }],
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write'],
    },
    {
      name: 'documents.patch',
      class: 'mutation',
      description:
        'Patch a Sanity document. `patch` is the Sanity patch envelope (e.g. `{ set: { title: "x" } }`). `ifRevisionId` must be the document\'s current `_rev`; mismatched revisions return 409.',
      parameters: {
        type: 'object',
        properties: {
          ...datasetLocator,
          documentId: { type: 'string' },
          patch: {
            type: 'object',
            description: 'Sanity patch operations (`set`, `setIfMissing`, `unset`, `inc`, `dec`, `insert`, `diffMatchPatch`).',
            additionalProperties: true,
          },
          ifRevisionId: {
            type: 'string',
            description: 'Current `_rev` of the document, returned from a prior read; mismatched revisions return 409.',
          },
        },
        required: ['dataset', 'documentId', 'patch'],
      },
      request: {
        method: 'POST',
        path: '/{apiVersion}/data/mutate/{dataset}',
        query: {
          returnIds: 'true',
          returnDocuments: 'true',
        },
        body: {
          mutations: [
            {
              patch: {
                id: '{documentId}',
                ifRevisionID: '{ifRevisionId}',
                set: '{patch.set}',
                setIfMissing: '{patch.setIfMissing}',
                unset: '{patch.unset}',
                inc: '{patch.inc}',
                dec: '{patch.dec}',
                insert: '{patch.insert}',
              },
            },
          ],
        },
      },
      cas: 'etag-if-match',
      externalEffect: true,
      requiredScopes: ['write'],
    },
    {
      name: 'documents.delete',
      class: 'mutation',
      description: 'Delete a Sanity document by ID. Wrapped as a single-mutation transaction so retries collapse.',
      parameters: {
        type: 'object',
        properties: {
          ...datasetLocator,
          documentId: { type: 'string' },
        },
        required: ['dataset', 'documentId'],
      },
      request: {
        method: 'POST',
        path: '/{apiVersion}/data/mutate/{dataset}',
        query: {
          returnIds: 'true',
        },
        body: {
          mutations: [{ delete: { id: '{documentId}' } }],
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write'],
    },
    {
      name: 'documents.createOrReplace',
      class: 'mutation',
      description:
        'Create a Sanity document, or replace it wholesale if a document with the same `_id` already exists. The caller passes the full document body including `_id` and `_type`.',
      parameters: {
        type: 'object',
        properties: {
          ...datasetLocator,
          document: {
            type: 'object',
            description: 'Document body. Must include `_id` and `_type`.',
            additionalProperties: true,
          },
        },
        required: ['dataset', 'document'],
      },
      request: {
        method: 'POST',
        path: '/{apiVersion}/data/mutate/{dataset}',
        query: {
          returnIds: 'true',
          returnDocuments: 'true',
        },
        body: {
          mutations: [{ createOrReplace: '{document}' }],
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write'],
    },
    {
      name: 'documents.publish',
      class: 'mutation',
      description:
        'Publish a Sanity draft document. Issues a `sanity.action.document.publish` action against the dataset; `draftId` is typically `drafts.<publishedId>`.',
      parameters: {
        type: 'object',
        properties: {
          ...datasetLocator,
          draftId: { type: 'string', description: 'Draft document _id, usually `drafts.<publishedId>`.' },
          publishedId: { type: 'string', description: 'Published document _id (without the `drafts.` prefix).' },
        },
        required: ['dataset', 'draftId', 'publishedId'],
      },
      request: {
        method: 'POST',
        path: '/{apiVersion}/data/actions/{dataset}',
        body: {
          actions: [
            {
              actionType: 'sanity.action.document.publish',
              draftId: '{draftId}',
              publishedId: '{publishedId}',
            },
          ],
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write'],
    },
    {
      name: 'documents.delete-batch',
      class: 'mutation',
      description:
        'Delete multiple documents in a single Sanity transaction using a GROQ delete-by-query (`*[_id in $ids]`). All deletes commit or roll back together.',
      parameters: {
        type: 'object',
        properties: {
          ...datasetLocator,
          documentIds: {
            type: 'array',
            description: 'IDs of the documents to delete in a single transaction.',
            items: { type: 'string' },
          },
        },
        required: ['dataset', 'documentIds'],
      },
      request: {
        method: 'POST',
        path: '/{apiVersion}/data/mutate/{dataset}',
        query: {
          returnIds: 'true',
        },
        body: {
          mutations: [
            {
              delete: {
                query: '*[_id in $ids]',
                params: { ids: '{documentIds}' },
              },
            },
          ],
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['write'],
    },
  ],
})
