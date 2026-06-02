import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Weaviate vector database connector.
 *
 * Authentication: API-key issued from a Weaviate Cloud cluster (or a
 * self-hosted cluster running the api-key auth module). The key travels in a
 * standard `Authorization: Bearer …` header, matching the declarative-rest
 * default placement.
 *
 * Base URL: the per-cluster REST endpoint
 * (e.g. https://<cluster>.weaviate.network). Stored on the DataSource as
 * `clusterUrl` metadata so a single connector kind can serve many tenants /
 * environments without re-issuing OAuth clients.
 *
 * Endpoint surface covered (v1 REST):
 *   - Schema (classes / collections): list, get, create, delete.
 *   - Objects: list, get-by-id, create, update (PATCH-merge), replace (PUT),
 *     delete-by-id.
 *   - Search: GraphQL `Get` body (vector / hybrid / bm25 are all expressed as
 *     fields inside the same query), batch object insert.
 *
 * Capabilities that depend on multipart bodies, binary streams, or
 * gRPC-only paths (e.g. `/v1/backups` streaming, gRPC batch insert) are
 * intentionally omitted — they need a bespoke adapter, not declarative-rest.
 */
export const weaviateConnector = declarativeRestConnector({
  kind: 'weaviate',
  displayName: 'Weaviate',
  description:
    'Manage Weaviate vector-database schemas (collections), CRUD individual objects, run vector / hybrid / BM25 search via GraphQL, and batch-insert objects against a Weaviate Cloud or self-hosted cluster.',
  auth: {
    kind: 'api-key',
    hint: 'Weaviate Cloud cluster API key. Create one under the cluster details page at https://console.weaviate.cloud. Self-hosted clusters must enable the api-key auth module.',
  },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  // The cluster URL is per-DataSource. `metadataKey` makes a single connector
  // kind work for every tenant; no shared fallback because there is no
  // canonical Weaviate host.
  baseUrl: { metadataKey: 'clusterUrl' },
  credentialPlacement: { kind: 'bearer' },
  // /v1/meta is the canonical low-cost authenticated probe.
  test: { method: 'GET', path: '/v1/meta' },
  capabilities: [
    {
      name: 'schema.list',
      class: 'read',
      description: 'List every collection (class) currently defined on the cluster, with its full property schema and vectorizer config.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/v1/schema' },
    },
    {
      name: 'schema.get',
      class: 'read',
      description: 'Fetch the schema definition for a single collection (class) by name.',
      parameters: {
        type: 'object',
        properties: {
          className: { type: 'string', description: 'Weaviate class / collection name (capitalised by convention).' },
        },
        required: ['className'],
      },
      request: { method: 'GET', path: '/v1/schema/{className}' },
    },
    {
      name: 'schema.create',
      class: 'mutation',
      description:
        'Create a new collection (class) with the supplied property + vectorizer config. The body must be a Weaviate class definition object (class, vectorizer, properties, …).',
      parameters: {
        type: 'object',
        properties: {
          class: { type: 'string' },
          description: { type: 'string' },
          vectorizer: { type: 'string', description: 'Vectorizer module id, e.g. text2vec-openai, text2vec-cohere, none.' },
          moduleConfig: { type: 'object' },
          vectorIndexType: { type: 'string' },
          vectorIndexConfig: { type: 'object' },
          properties: {
            type: 'array',
            items: { type: 'object' },
            description: 'Ordered property list — each item is { name, dataType[], description?, indexFilterable?, indexSearchable?, moduleConfig? }.',
          },
          invertedIndexConfig: { type: 'object' },
          replicationConfig: { type: 'object' },
          shardingConfig: { type: 'object' },
          multiTenancyConfig: { type: 'object' },
        },
        required: ['class'],
      },
      request: { method: 'POST', path: '/v1/schema', body: 'args' },
      // Re-posting the same class name returns HTTP 422 "class already
      // exists" — the server does not dedupe, so the caller owns it.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'schema.delete',
      class: 'mutation',
      description: 'Delete a collection (class) and every object stored under it. Irreversible.',
      parameters: {
        type: 'object',
        properties: { className: { type: 'string' } },
        required: ['className'],
      },
      request: { method: 'DELETE', path: '/v1/schema/{className}' },
      // Re-deleting a missing class returns 404; deleting an existing one
      // succeeds — treat as native-idempotent for the agent's purposes.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'objects.list',
      class: 'read',
      description:
        'List objects in a collection. Supports limit/offset/after-cursor pagination and the `include=vector,classification` parameter.',
      parameters: {
        type: 'object',
        properties: {
          className: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 10000 },
          offset: { type: 'integer', minimum: 0 },
          after: { type: 'string', description: 'Cursor — UUID of the last object from the previous page.' },
          include: { type: 'string', description: 'Comma-separated extras to inline: vector, classification, featureProjection.' },
        },
        required: ['className'],
      },
      request: {
        method: 'GET',
        path: '/v1/objects',
        query: {
          class: '{className}',
          limit: '{limit}',
          offset: '{offset}',
          after: '{after}',
          include: '{include}',
        },
      },
    },
    {
      name: 'objects.get',
      class: 'read',
      description: 'Fetch a single object by UUID within a collection. Pass include=vector to inline the embedding.',
      parameters: {
        type: 'object',
        properties: {
          className: { type: 'string' },
          id: { type: 'string', description: 'Object UUID (v3 or v5).' },
          include: { type: 'string' },
        },
        required: ['className', 'id'],
      },
      request: {
        method: 'GET',
        path: '/v1/objects/{className}/{id}',
        query: { include: '{include}' },
      },
    },
    {
      name: 'objects.create',
      class: 'mutation',
      description:
        'Insert one object. Body must include `class` and `properties`; pass `vector` to skip server-side vectorization, or `id` to assign a deterministic UUID (the recommended dedupe path).',
      parameters: {
        type: 'object',
        properties: {
          class: { type: 'string' },
          id: { type: 'string', description: 'Optional deterministic UUID — when supplied, repeat inserts on the same UUID return 422 instead of creating duplicates.' },
          properties: { type: 'object' },
          vector: { type: 'array', items: { type: 'number' } },
          vectors: { type: 'object', description: 'Named-vector map for collections configured with multiple vector spaces.' },
          tenant: { type: 'string', description: 'Tenant id for multi-tenant collections.' },
        },
        required: ['class', 'properties'],
      },
      request: { method: 'POST', path: '/v1/objects', body: 'args' },
      // Deterministic UUIDs give the caller idempotency; without an id the
      // server mints a new one on every call. We pick `native-idempotency`
      // because the recommended pattern is UUID-keyed.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'objects.update',
      class: 'mutation',
      description:
        'Merge-update an object: properties supplied in the body overwrite their counterparts, untouched properties are preserved (PATCH semantics).',
      parameters: {
        type: 'object',
        properties: {
          className: { type: 'string' },
          id: { type: 'string' },
          properties: { type: 'object' },
          vector: { type: 'array', items: { type: 'number' } },
          vectors: { type: 'object' },
        },
        required: ['className', 'id', 'properties'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/objects/{className}/{id}',
        body: { class: '{className}', id: '{id}', properties: '{properties}', vector: '{vector}', vectors: '{vectors}' },
      },
      // PATCH-merge is idempotent for the same body.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'objects.replace',
      class: 'mutation',
      description:
        'Replace an object in place (PUT semantics): every property must be present in the body, omitted properties are cleared.',
      parameters: {
        type: 'object',
        properties: {
          className: { type: 'string' },
          id: { type: 'string' },
          properties: { type: 'object' },
          vector: { type: 'array', items: { type: 'number' } },
          vectors: { type: 'object' },
        },
        required: ['className', 'id', 'properties'],
      },
      request: {
        method: 'PUT',
        path: '/v1/objects/{className}/{id}',
        body: { class: '{className}', id: '{id}', properties: '{properties}', vector: '{vector}', vectors: '{vectors}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'objects.delete',
      class: 'mutation',
      description: 'Delete a single object by UUID.',
      parameters: {
        type: 'object',
        properties: {
          className: { type: 'string' },
          id: { type: 'string' },
        },
        required: ['className', 'id'],
      },
      request: { method: 'DELETE', path: '/v1/objects/{className}/{id}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'graphql.query',
      class: 'read',
      description:
        'Run an arbitrary GraphQL query against the cluster. Vector search, hybrid search, BM25, aggregations, and `Explore` are all expressed as GraphQL queries — the caller composes the query string.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'GraphQL query string. Example: `{ Get { Article(nearText: { concepts: ["AI"] }, limit: 5) { title _additional { id distance } } } }`.',
          },
          variables: { type: 'object' },
          operationName: { type: 'string' },
        },
        required: ['query'],
      },
      request: {
        method: 'POST',
        path: '/v1/graphql',
        body: { query: '{query}', variables: '{variables}', operationName: '{operationName}' },
      },
    },
    {
      name: 'batch.objects.create',
      class: 'mutation',
      description:
        'Insert a batch of objects in one round-trip. Body is `{ objects: [...] }` where each item matches the single-object body. The server returns per-item success/error; the caller must inspect the result array.',
      parameters: {
        type: 'object',
        properties: {
          objects: {
            type: 'array',
            description: 'Up to ~100 objects per request (cluster-configurable). Each item carries class, properties, optional id/vector/vectors/tenant.',
            items: { type: 'object' },
          },
          consistencyLevel: { type: 'string', description: 'ONE | QUORUM | ALL — overrides the cluster default.' },
        },
        required: ['objects'],
      },
      request: {
        method: 'POST',
        path: '/v1/batch/objects',
        query: { consistency_level: '{consistencyLevel}' },
        body: { objects: '{objects}' },
      },
      // Server does not dedupe batches; deterministic UUIDs on each item are
      // the caller's only safety net.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'batch.objects.delete',
      class: 'mutation',
      description:
        'Delete every object in a collection matching a where-filter. Body is `{ match: { class, where } }`. Returns a summary of matched / deleted / failed counts.',
      parameters: {
        type: 'object',
        properties: {
          className: { type: 'string' },
          where: { type: 'object', description: 'Weaviate where-filter operator tree (path, operator, value*).' },
          output: { type: 'string', description: 'minimal | verbose — verbose lists per-object outcomes.' },
          dryRun: { type: 'boolean' },
          consistencyLevel: { type: 'string' },
        },
        required: ['className', 'where'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/batch/objects',
        query: { consistency_level: '{consistencyLevel}' },
        body: {
          match: { class: '{className}', where: '{where}' },
          output: '{output}',
          dryRun: '{dryRun}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'meta.get',
      class: 'read',
      description: 'Fetch cluster metadata: version, hostname, enabled modules and their configs. Useful for capability discovery.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/meta' },
    },
    {
      name: 'nodes.list',
      class: 'read',
      description: 'Return per-node cluster status: name, status, version, shard counts. Useful for health and rebalancing dashboards.',
      parameters: {
        type: 'object',
        properties: {
          output: { type: 'string', description: 'minimal | verbose.' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/nodes',
        query: { output: '{output}' },
      },
    },
    {
      name: 'classes.update',
      class: 'mutation',
      description:
        'Update a class/collection schema in place. Body is a full class definition object; non-mutable settings (vectorizer, properties) must match the existing class — only invertedIndexConfig, replicationConfig, vectorIndexConfig and description are practically mutable.',
      parameters: {
        type: 'object',
        properties: {
          className: { type: 'string' },
          class: { type: 'string', description: 'Must equal className.' },
          description: { type: 'string' },
          vectorIndexConfig: { type: 'object' },
          invertedIndexConfig: { type: 'object' },
          replicationConfig: { type: 'object' },
          shardingConfig: { type: 'object' },
          multiTenancyConfig: { type: 'object' },
        },
        required: ['className', 'class'],
      },
      request: {
        method: 'PUT',
        path: '/v1/schema/{className}',
        body: 'args',
      },
      // PUT-replace on the same body lands the same end state.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'schema.shards',
      class: 'read',
      description: 'List shards for a class with their READY/READONLY/INDEXING status. Used to drive rebalancing and read-only failover decisions.',
      parameters: {
        type: 'object',
        properties: {
          className: { type: 'string' },
          tenant: { type: 'string', description: 'Tenant id for multi-tenant collections.' },
        },
        required: ['className'],
      },
      request: {
        method: 'GET',
        path: '/v1/schema/{className}/shards',
        query: { tenant: '{tenant}' },
      },
    },
    {
      name: 'backups.create',
      class: 'mutation',
      description:
        'Create a backup snapshot to a configured backend (filesystem / s3 / gcs / azure). Body carries backup id and optional include/exclude class lists. The backup_id is the caller-supplied dedupe key.',
      parameters: {
        type: 'object',
        properties: {
          backend: { type: 'string', description: 'Backup backend module id, e.g. filesystem, s3, gcs, azure.' },
          id: { type: 'string', description: 'Caller-chosen backup id; lowercase letters/digits/_-.' },
          include: { type: 'array', items: { type: 'string' } },
          exclude: { type: 'array', items: { type: 'string' } },
          config: { type: 'object', description: 'Backend-specific overrides (e.g. chunkSize).' },
        },
        required: ['backend', 'id'],
      },
      request: {
        method: 'POST',
        path: '/v1/backups/{backend}',
        body: 'args',
      },
      // backup id is the dedupe key — repeating the same (backend, id) returns
      // 422 instead of duplicating, which is the native-idempotency contract
      // the planner expects.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'backups.restore',
      class: 'mutation',
      description:
        'Restore a previously-created backup snapshot. Specify backend + id; optional include/exclude narrows the restore scope.',
      parameters: {
        type: 'object',
        properties: {
          backend: { type: 'string' },
          id: { type: 'string' },
          include: { type: 'array', items: { type: 'string' } },
          exclude: { type: 'array', items: { type: 'string' } },
          config: { type: 'object' },
          nodeMapping: { type: 'object', description: 'Map original node names to current cluster nodes.' },
        },
        required: ['backend', 'id'],
      },
      request: {
        method: 'POST',
        path: '/v1/backups/{backend}/{id}/restore',
        body: 'args',
      },
      // Restoring the same (backend, id) twice into a non-overlapping target
      // set is idempotent; overlapping restores 422 — same contract as create.
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
