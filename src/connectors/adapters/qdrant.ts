import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Qdrant vector database connector.
 *
 * Authentication: API key delivered in the `api-key` header. Qdrant Cloud
 * issues per-cluster API keys (Console → Data Access Control → API Keys);
 * self-hosted clusters set the same header value via service config. There is
 * no OAuth surface — Qdrant Cloud's management plane uses keys end-to-end.
 *
 * Base URL is per-cluster (e.g. `https://xyz-uuid.us-east-1-0.aws.cloud.qdrant.io:6333`)
 * and therefore resolved from connection metadata.qdrantUrl at invocation
 * time, not baked into the adapter. The trailing `:6333` is part of the
 * Qdrant REST port — callers MUST store the full origin including port.
 *
 * Endpoint surface covered: collection lifecycle (create / get / list / delete
 * / update params), point lifecycle (upsert / get / delete / batch update),
 * search and query primitives (single, batch, recommend, scroll, count),
 * payload index management, and snapshot operations. Telemetry-only routes
 * (`/telemetry`, `/metrics`) are intentionally omitted — they leak cluster
 * internals and aren't useful to agent invocations.
 */
export const qdrantConnector = declarativeRestConnector({
  kind: 'qdrant',
  displayName: 'Qdrant',
  description:
    'Manage Qdrant vector collections, upsert and query points, run similarity search and recommendation queries, and manage payload indexes and snapshots.',
  auth: {
    kind: 'api-key',
    hint: 'Qdrant Cloud cluster API key. Generate one in the Qdrant Cloud Console under Data Access Control → API Keys, scoped to the target cluster.',
  },
  category: 'other',
  // Qdrant exposes optimistic concurrency on points via the `wait` param +
  // `ordering` semantics, but collection-level mutations are last-writer-wins;
  // we surface advisory as the safe default and let the caller opt in to
  // verify-after-write where it matters.
  defaultConsistencyModel: 'advisory',
  baseUrl: { metadataKey: 'qdrantUrl' },
  credentialPlacement: { kind: 'header', header: 'api-key' },
  // GET / is the canonical cheap probe — returns title + version, requires
  // a valid api-key when API key auth is enabled.
  test: { method: 'GET', path: '/' },
  capabilities: [
    // === Collection lifecycle ===
    {
      name: 'collections.list',
      class: 'read',
      description: 'List all collections in the cluster.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/collections' },
    },
    {
      name: 'collections.get',
      class: 'read',
      description: 'Get detailed info for a single collection (config, points count, status).',
      parameters: {
        type: 'object',
        properties: { collection_name: { type: 'string' } },
        required: ['collection_name'],
      },
      request: { method: 'GET', path: '/collections/{collection_name}' },
    },
    {
      name: 'collections.exists',
      class: 'read',
      description: 'Check whether a collection exists.',
      parameters: {
        type: 'object',
        properties: { collection_name: { type: 'string' } },
        required: ['collection_name'],
      },
      request: { method: 'GET', path: '/collections/{collection_name}/exists' },
    },
    {
      name: 'collections.create',
      class: 'mutation',
      description:
        'Create a new collection. Body carries vectors config (size + distance metric), optional sparse_vectors, shard_number, replication_factor, hnsw_config, quantization_config, on_disk_payload, sharding_method.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          vectors: {
            description: 'Either a single VectorParams object or a map of named vectors → VectorParams.',
          },
          sparse_vectors: { type: 'object' },
          shard_number: { type: 'integer', minimum: 1 },
          replication_factor: { type: 'integer', minimum: 1 },
          write_consistency_factor: { type: 'integer', minimum: 1 },
          on_disk_payload: { type: 'boolean' },
          hnsw_config: { type: 'object' },
          wal_config: { type: 'object' },
          optimizers_config: { type: 'object' },
          quantization_config: { type: 'object' },
          init_from: { type: 'object' },
          sharding_method: { type: 'string', enum: ['auto', 'custom'] },
          strict_mode_config: { type: 'object' },
        },
        required: ['collection_name', 'vectors'],
      },
      request: {
        method: 'PUT',
        path: '/collections/{collection_name}',
        body: {
          vectors: '{vectors}',
          sparse_vectors: '{sparse_vectors}',
          shard_number: '{shard_number}',
          replication_factor: '{replication_factor}',
          write_consistency_factor: '{write_consistency_factor}',
          on_disk_payload: '{on_disk_payload}',
          hnsw_config: '{hnsw_config}',
          wal_config: '{wal_config}',
          optimizers_config: '{optimizers_config}',
          quantization_config: '{quantization_config}',
          init_from: '{init_from}',
          sharding_method: '{sharding_method}',
          strict_mode_config: '{strict_mode_config}',
        },
      },
      // PUT on a fixed collection name is idempotent: replay against an
      // existing collection with the same params is a no-op (Qdrant returns
      // 409 on conflicting params; the engine maps that to status:conflict).
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'collections.update',
      class: 'mutation',
      description:
        'Update collection parameters (optimizer config, HNSW config, quantization config, params, vectors config). Used to retune an existing collection without recreating it.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          optimizers_config: { type: 'object' },
          params: { type: 'object' },
          hnsw_config: { type: 'object' },
          vectors_config: { type: 'object' },
          quantization_config: { type: 'object' },
          sparse_vectors_config: { type: 'object' },
          strict_mode_config: { type: 'object' },
        },
        required: ['collection_name'],
      },
      request: {
        method: 'PATCH',
        path: '/collections/{collection_name}',
        body: {
          optimizers_config: '{optimizers_config}',
          params: '{params}',
          hnsw_config: '{hnsw_config}',
          vectors_config: '{vectors_config}',
          quantization_config: '{quantization_config}',
          sparse_vectors_config: '{sparse_vectors_config}',
          strict_mode_config: '{strict_mode_config}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'collections.delete',
      class: 'mutation',
      description: 'Delete a collection and all of its points. Irreversible.',
      parameters: {
        type: 'object',
        properties: { collection_name: { type: 'string' } },
        required: ['collection_name'],
      },
      request: { method: 'DELETE', path: '/collections/{collection_name}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },

    // === Aliases ===
    {
      name: 'collections.aliases.list',
      class: 'read',
      description: 'List all collection aliases in the cluster.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/aliases' },
    },
    {
      name: 'collections.aliases.update',
      class: 'mutation',
      description:
        'Apply a batch of alias actions (create_alias / delete_alias / rename_alias). Atomic across the actions list.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array of { create_alias | delete_alias | rename_alias } objects.',
          },
        },
        required: ['actions'],
      },
      request: {
        method: 'POST',
        path: '/collections/aliases',
        body: { actions: '{actions}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },

    // === Payload indexes ===
    {
      name: 'collections.index.create',
      class: 'mutation',
      description:
        'Create a payload field index to accelerate filtered search. Body specifies field_name and field_schema (keyword / integer / float / geo / text / bool / datetime / uuid).',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          field_name: { type: 'string' },
          field_schema: {
            description: 'Either a schema string (e.g. "keyword") or an object with type + tokenizer options.',
          },
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name', 'field_name', 'field_schema'],
      },
      request: {
        method: 'PUT',
        path: '/collections/{collection_name}/index',
        query: { wait: '{wait}', ordering: '{ordering}' },
        body: {
          field_name: '{field_name}',
          field_schema: '{field_schema}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'collections.index.delete',
      class: 'mutation',
      description: 'Delete a payload field index by name.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          field_name: { type: 'string' },
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name', 'field_name'],
      },
      request: {
        method: 'DELETE',
        path: '/collections/{collection_name}/index/{field_name}',
        query: { wait: '{wait}', ordering: '{ordering}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },

    // === Point lifecycle ===
    {
      name: 'points.upsert',
      class: 'mutation',
      description:
        'Insert or update points. Body carries either { points: [{id, vector, payload?}, ...] } or { batch: {ids, vectors, payloads?} }. Pass wait=true to block until WAL fsync.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          points: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array of { id, vector, payload? } point structs.',
          },
          batch: {
            type: 'object',
            description: 'Columnar variant — { ids, vectors, payloads? }. Use either `points` or `batch`, not both.',
          },
          shard_key: {},
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name'],
      },
      request: {
        method: 'PUT',
        path: '/collections/{collection_name}/points',
        query: { wait: '{wait}', ordering: '{ordering}' },
        body: {
          points: '{points}',
          batch: '{batch}',
          shard_key: '{shard_key}',
        },
      },
      // Upsert with caller-supplied point ids is idempotent by construction.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'points.get',
      class: 'read',
      description: 'Fetch a batch of points by id, optionally returning vectors and/or payload.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          ids: { type: 'array', items: {}, description: 'Array of point ids (uint64 or uuid strings).' },
          with_payload: {},
          with_vector: {},
          shard_key: {},
          consistency: {},
        },
        required: ['collection_name', 'ids'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points',
        query: { consistency: '{consistency}' },
        body: {
          ids: '{ids}',
          with_payload: '{with_payload}',
          with_vector: '{with_vector}',
          shard_key: '{shard_key}',
        },
      },
    },
    {
      name: 'points.delete',
      class: 'mutation',
      description:
        'Delete points by explicit id list or by filter. Body is { points: [...ids] } or { filter: {...} }; pass exactly one.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          points: { type: 'array', items: {}, description: 'Array of point ids to delete.' },
          filter: { type: 'object', description: 'Qdrant filter object — must / must_not / should clauses.' },
          shard_key: {},
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/delete',
        query: { wait: '{wait}', ordering: '{ordering}' },
        body: {
          points: '{points}',
          filter: '{filter}',
          shard_key: '{shard_key}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'points.set_payload',
      class: 'mutation',
      description: 'Merge a payload object into the existing payloads of selected points.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          payload: { type: 'object' },
          points: { type: 'array', items: {} },
          filter: { type: 'object' },
          key: { type: 'string' },
          shard_key: {},
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name', 'payload'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/payload',
        query: { wait: '{wait}', ordering: '{ordering}' },
        body: {
          payload: '{payload}',
          points: '{points}',
          filter: '{filter}',
          key: '{key}',
          shard_key: '{shard_key}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'points.overwrite_payload',
      class: 'mutation',
      description: 'Replace the entire payload of selected points with the supplied object.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          payload: { type: 'object' },
          points: { type: 'array', items: {} },
          filter: { type: 'object' },
          shard_key: {},
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name', 'payload'],
      },
      request: {
        method: 'PUT',
        path: '/collections/{collection_name}/points/payload',
        query: { wait: '{wait}', ordering: '{ordering}' },
        body: {
          payload: '{payload}',
          points: '{points}',
          filter: '{filter}',
          shard_key: '{shard_key}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'points.delete_payload',
      class: 'mutation',
      description: 'Delete a list of payload keys from selected points.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          keys: { type: 'array', items: { type: 'string' } },
          points: { type: 'array', items: {} },
          filter: { type: 'object' },
          shard_key: {},
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name', 'keys'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/payload/delete',
        query: { wait: '{wait}', ordering: '{ordering}' },
        body: {
          keys: '{keys}',
          points: '{points}',
          filter: '{filter}',
          shard_key: '{shard_key}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'points.clear_payload',
      class: 'mutation',
      description: 'Remove all payload from selected points.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          points: { type: 'array', items: {} },
          filter: { type: 'object' },
          shard_key: {},
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/payload/clear',
        query: { wait: '{wait}', ordering: '{ordering}' },
        body: {
          points: '{points}',
          filter: '{filter}',
          shard_key: '{shard_key}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'points.update_vectors',
      class: 'mutation',
      description: 'Update vector values for a list of points (named vectors supported).',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          points: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array of { id, vector } where vector is either a list or a name→list map.',
          },
          shard_key: {},
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name', 'points'],
      },
      request: {
        method: 'PUT',
        path: '/collections/{collection_name}/points/vectors',
        query: { wait: '{wait}', ordering: '{ordering}' },
        body: { points: '{points}', shard_key: '{shard_key}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'points.delete_vectors',
      class: 'mutation',
      description: 'Delete named vectors from selected points without removing the points themselves.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          vector: { type: 'array', items: { type: 'string' }, description: 'List of vector names to drop.' },
          points: { type: 'array', items: {} },
          filter: { type: 'object' },
          shard_key: {},
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name', 'vector'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/vectors/delete',
        query: { wait: '{wait}', ordering: '{ordering}' },
        body: {
          vector: '{vector}',
          points: '{points}',
          filter: '{filter}',
          shard_key: '{shard_key}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'points.batch_update',
      class: 'mutation',
      description:
        'Apply a heterogeneous batch of point operations (upsert / delete / set_payload / overwrite_payload / delete_payload / clear_payload / update_vectors / delete_vectors) atomically per-shard.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          operations: { type: 'array', items: { type: 'object' } },
          wait: { type: 'boolean' },
          ordering: { type: 'string', enum: ['weak', 'medium', 'strong'] },
        },
        required: ['collection_name', 'operations'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/batch',
        query: { wait: '{wait}', ordering: '{ordering}' },
        body: { operations: '{operations}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },

    // === Search and query ===
    {
      name: 'points.search',
      class: 'read',
      description:
        'Run a similarity search. Body carries vector (or named { name, vector }), optional filter, params (hnsw_ef, exact), limit, offset, with_payload, with_vector, score_threshold.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          vector: {},
          filter: { type: 'object' },
          params: { type: 'object' },
          limit: { type: 'integer', minimum: 1 },
          offset: { type: 'integer', minimum: 0 },
          with_payload: {},
          with_vector: {},
          score_threshold: { type: 'number' },
          shard_key: {},
          consistency: {},
          timeout: { type: 'integer' },
        },
        required: ['collection_name', 'vector', 'limit'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/search',
        query: { consistency: '{consistency}', timeout: '{timeout}' },
        body: {
          vector: '{vector}',
          filter: '{filter}',
          params: '{params}',
          limit: '{limit}',
          offset: '{offset}',
          with_payload: '{with_payload}',
          with_vector: '{with_vector}',
          score_threshold: '{score_threshold}',
          shard_key: '{shard_key}',
        },
      },
    },
    {
      name: 'points.search_batch',
      class: 'read',
      description: 'Execute many similarity searches in a single request against one collection.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          searches: { type: 'array', items: { type: 'object' } },
          consistency: {},
          timeout: { type: 'integer' },
        },
        required: ['collection_name', 'searches'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/search/batch',
        query: { consistency: '{consistency}', timeout: '{timeout}' },
        body: { searches: '{searches}' },
      },
    },
    {
      name: 'points.query',
      class: 'read',
      description:
        'Unified query endpoint — supports nearest-neighbour, recommend, discover, context, fusion, and prefetch pipelines. Body is a Query object per Qdrant ≥1.10.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          query: {},
          prefetch: {},
          using: { type: 'string' },
          filter: { type: 'object' },
          params: { type: 'object' },
          limit: { type: 'integer', minimum: 1 },
          offset: { type: 'integer', minimum: 0 },
          with_payload: {},
          with_vector: {},
          score_threshold: { type: 'number' },
          shard_key: {},
          lookup_from: { type: 'object' },
          consistency: {},
          timeout: { type: 'integer' },
        },
        required: ['collection_name'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/query',
        query: { consistency: '{consistency}', timeout: '{timeout}' },
        body: {
          query: '{query}',
          prefetch: '{prefetch}',
          using: '{using}',
          filter: '{filter}',
          params: '{params}',
          limit: '{limit}',
          offset: '{offset}',
          with_payload: '{with_payload}',
          with_vector: '{with_vector}',
          score_threshold: '{score_threshold}',
          shard_key: '{shard_key}',
          lookup_from: '{lookup_from}',
        },
      },
    },
    {
      name: 'points.query_batch',
      class: 'read',
      description: 'Batch variant of the unified query endpoint.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          searches: { type: 'array', items: { type: 'object' } },
          consistency: {},
          timeout: { type: 'integer' },
        },
        required: ['collection_name', 'searches'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/query/batch',
        query: { consistency: '{consistency}', timeout: '{timeout}' },
        body: { searches: '{searches}' },
      },
    },
    {
      name: 'points.recommend',
      class: 'read',
      description:
        'Recommend points by example: positive and/or negative example point ids (or raw vectors), optional filter, params, limit.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          positive: { type: 'array', items: {} },
          negative: { type: 'array', items: {} },
          strategy: { type: 'string', enum: ['average_vector', 'best_score'] },
          filter: { type: 'object' },
          params: { type: 'object' },
          limit: { type: 'integer', minimum: 1 },
          offset: { type: 'integer', minimum: 0 },
          with_payload: {},
          with_vector: {},
          score_threshold: { type: 'number' },
          using: { type: 'string' },
          lookup_from: { type: 'object' },
          shard_key: {},
          consistency: {},
          timeout: { type: 'integer' },
        },
        required: ['collection_name'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/recommend',
        query: { consistency: '{consistency}', timeout: '{timeout}' },
        body: {
          positive: '{positive}',
          negative: '{negative}',
          strategy: '{strategy}',
          filter: '{filter}',
          params: '{params}',
          limit: '{limit}',
          offset: '{offset}',
          with_payload: '{with_payload}',
          with_vector: '{with_vector}',
          score_threshold: '{score_threshold}',
          using: '{using}',
          lookup_from: '{lookup_from}',
          shard_key: '{shard_key}',
        },
      },
    },
    {
      name: 'points.scroll',
      class: 'read',
      description:
        'Paginated scan of points matching an optional filter. Returns the next `offset` token for the next page.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          offset: {},
          limit: { type: 'integer', minimum: 1 },
          filter: { type: 'object' },
          with_payload: {},
          with_vector: {},
          order_by: {},
          shard_key: {},
          consistency: {},
          timeout: { type: 'integer' },
        },
        required: ['collection_name'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/scroll',
        query: { consistency: '{consistency}', timeout: '{timeout}' },
        body: {
          offset: '{offset}',
          limit: '{limit}',
          filter: '{filter}',
          with_payload: '{with_payload}',
          with_vector: '{with_vector}',
          order_by: '{order_by}',
          shard_key: '{shard_key}',
        },
      },
    },
    {
      name: 'points.count',
      class: 'read',
      description: 'Count points matching an optional filter. Pass exact=false for an approximate fast path.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          filter: { type: 'object' },
          exact: { type: 'boolean' },
          shard_key: {},
          consistency: {},
          timeout: { type: 'integer' },
        },
        required: ['collection_name'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/points/count',
        query: { consistency: '{consistency}', timeout: '{timeout}' },
        body: {
          filter: '{filter}',
          exact: '{exact}',
          shard_key: '{shard_key}',
        },
      },
    },

    // === Snapshots ===
    {
      name: 'snapshots.list',
      class: 'read',
      description: 'List snapshots for a collection.',
      parameters: {
        type: 'object',
        properties: { collection_name: { type: 'string' } },
        required: ['collection_name'],
      },
      request: { method: 'GET', path: '/collections/{collection_name}/snapshots' },
    },
    {
      name: 'snapshots.create',
      class: 'mutation',
      description: 'Create a new snapshot of the named collection.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          wait: { type: 'boolean' },
        },
        required: ['collection_name'],
      },
      request: {
        method: 'POST',
        path: '/collections/{collection_name}/snapshots',
        query: { wait: '{wait}' },
        body: {},
      },
      // Snapshot create is non-idempotent — each call materialises a fresh
      // timestamped snapshot file. Caller-owned dedupe only.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'snapshots.delete',
      class: 'mutation',
      description: 'Delete a snapshot by name.',
      parameters: {
        type: 'object',
        properties: {
          collection_name: { type: 'string' },
          snapshot_name: { type: 'string' },
          wait: { type: 'boolean' },
        },
        required: ['collection_name', 'snapshot_name'],
      },
      request: {
        method: 'DELETE',
        path: '/collections/{collection_name}/snapshots/{snapshot_name}',
        query: { wait: '{wait}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'snapshots.list_full',
      class: 'read',
      description: 'List full-cluster snapshots (all collections).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/snapshots' },
    },

    // === Cluster ===
    {
      name: 'cluster.info',
      class: 'read',
      description: 'Get cluster topology: peer ids, leader, raft state. Useful for routing-aware clients.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/cluster' },
    },
    {
      name: 'cluster.collection_info',
      class: 'read',
      description: 'Get per-shard placement and replication state for a collection.',
      parameters: {
        type: 'object',
        properties: { collection_name: { type: 'string' } },
        required: ['collection_name'],
      },
      request: { method: 'GET', path: '/collections/{collection_name}/cluster' },
    },
  ],
})
