import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Couchbase (https://www.couchbase.com/docs/server/current/rest-api).
 *
 * Auth: HTTP Basic with cluster username and password.
 * The catalog entry lists no explicit actions, but Couchbase exposes a
 * comprehensive REST API for cluster management, bucket/collection operations,
 * N1QL query execution, and document CRUD. This adapter models document queries,
 * read/write/delete operations, and cluster health introspection.
 */
export const couchbaseConnector = declarativeRestConnector({
  kind: 'couchbase',
  displayName: 'Couchbase',
  description: 'Query documents, read/write/delete records, and manage Couchbase buckets and clusters.',
  auth: {
    kind: 'api-key',
    hint: 'Couchbase username and password for cluster access.',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'clusterUrl' },
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Basic ' },
  defaultHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
  test: { method: 'GET', path: '/pools' },
  capabilities: [
    {
      name: 'cluster.info',
      class: 'read',
      description: 'Get cluster information and node status.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/pools' },
    },
    {
      name: 'buckets.list',
      class: 'read',
      description: 'List all buckets in the cluster.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/pools/default/buckets' },
    },
    {
      name: 'documents.query',
      class: 'read',
      description: 'Execute a N1QL query to search and retrieve documents.',
      parameters: {
        type: 'object',
        properties: {
          statement: { type: 'string' },
          timeout: { type: 'string' },
          consistency: { type: 'string' },
        },
        required: ['statement'],
      },
      request: {
        method: 'POST',
        path: '/query/service',
        body: { statement: '{statement}', timeout: '{timeout}', consistency: '{consistency}' },
      },
    },
    {
      name: 'documents.get',
      class: 'read',
      description: 'Retrieve a document by its key.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string' },
          scope: { type: 'string' },
          collection: { type: 'string' },
          docId: { type: 'string' },
        },
        required: ['bucket', 'docId'],
      },
      request: {
        method: 'GET',
        path: '/buckets/{bucket}/scopes/{scope}/collections/{collection}/docs/{docId}',
      },
    },
    {
      name: 'documents.create',
      class: 'mutation',
      description: 'Insert a new document into a bucket.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string' },
          scope: { type: 'string' },
          collection: { type: 'string' },
          docId: { type: 'string' },
          content: { type: 'object' },
        },
        required: ['bucket', 'docId', 'content'],
      },
      request: {
        method: 'POST',
        path: '/buckets/{bucket}/scopes/{scope}/collections/{collection}/docs',
        body: { content: '{content}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.update',
      class: 'mutation',
      description: 'Update an existing document by ID.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string' },
          scope: { type: 'string' },
          collection: { type: 'string' },
          docId: { type: 'string' },
          content: { type: 'object' },
        },
        required: ['bucket', 'docId', 'content'],
      },
      request: {
        method: 'PUT',
        path: '/buckets/{bucket}/scopes/{scope}/collections/{collection}/docs/{docId}',
        body: '{content}',
      },
      cas: 'etag-if-match',
    },
    {
      name: 'documents.delete',
      class: 'mutation',
      description: 'Delete a document by its key.',
      parameters: {
        type: 'object',
        properties: {
          bucket: { type: 'string' },
          scope: { type: 'string' },
          collection: { type: 'string' },
          docId: { type: 'string' },
        },
        required: ['bucket', 'docId'],
      },
      request: {
        method: 'DELETE',
        path: '/buckets/{bucket}/scopes/{scope}/collections/{collection}/docs/{docId}',
      },
      cas: 'etag-if-match',
    },
  ],
})
