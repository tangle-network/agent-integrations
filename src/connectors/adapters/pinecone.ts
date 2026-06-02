import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Pinecone vector database connector.
 *
 * Authentication: workspace API key delivered in the `Api-Key` header (Pinecone
 * does not expose a 3-legged OAuth flow). Keys are minted at
 * https://app.pinecone.io/organizations/-/projects/-/keys and are scoped to a
 * single project; if the customer needs cross-project access they must connect
 * one DataSource per project.
 *
 * Pinecone splits its surface across two host families:
 *   - Control plane (this connector's fallback `https://api.pinecone.io`):
 *     index management, collection management, assistant management. Every
 *     project shares this host.
 *   - Data plane (per-index host, e.g. `https://idx-xxxxxxx.svc.aped-4627-b74a.pinecone.io`):
 *     vector upsert / query / fetch / update / delete / list. The host is
 *     returned by `GET /indexes/{name}` as `.host` and the consumer is expected
 *     to stash it on `DataSource.metadata.indexHost` before invoking any
 *     `vectors.*` capability. Operating with a stale or wrong host yields a
 *     404 / DNS failure — there is no graceful degradation.
 *
 * Versioning: every request must carry `X-Pinecone-API-Version`. Pinned at
 * construction so the connector contract survives the vendor rolling new
 * versions; bump in lock-step with capability changes.
 */
const PINECONE_API_VERSION = '2025-04'

export const pineconeConnector = declarativeRestConnector({
  kind: 'pinecone',
  displayName: 'Pinecone',
  description:
    'Manage Pinecone indexes and collections, upsert and query dense / sparse vectors, fetch by id, and drive Pinecone Assistants. Vector data-plane calls require metadata.indexHost from the index describe response.',
  auth: {
    kind: 'api-key',
    hint: 'Pinecone API key (pcsk_…) from https://app.pinecone.io → Project → API Keys. Project-scoped — connect one DataSource per Pinecone project. For data-plane operations also set metadata.indexHost to the host returned by GET /indexes/{indexName}.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'indexHost', fallback: 'https://api.pinecone.io' },
  credentialPlacement: { kind: 'header', header: 'Api-Key' },
  defaultHeaders: {
    'X-Pinecone-API-Version': PINECONE_API_VERSION,
  },
  // GET /indexes is the canonical low-cost authenticated probe; it always
  // hits the control plane regardless of whether metadata.indexHost is set,
  // because the metadata override is only honoured when present and we want
  // `test` to be reachable from a freshly-connected DataSource that has not
  // yet performed an index-describe.
  test: { method: 'GET', path: '/indexes' },
  capabilities: [
    // ─── Control plane: indexes ────────────────────────────────────────
    {
      name: 'indexes.list',
      class: 'read',
      description: 'List every index in the project the API key is scoped to. Returns name, dimension, metric, spec, status, host.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/indexes' },
    },
    {
      name: 'indexes.describe',
      class: 'read',
      description: 'Fetch metadata for a single index. The returned .host is what the caller must persist on metadata.indexHost before invoking any vectors.* capability.',
      parameters: {
        type: 'object',
        properties: { indexName: { type: 'string' } },
        required: ['indexName'],
      },
      request: { method: 'GET', path: '/indexes/{indexName}' },
    },
    {
      name: 'indexes.create',
      class: 'mutation',
      description:
        'Create a new index. Pass `name`, `dimension`, `metric` (cosine|euclidean|dotproduct), and `spec` (serverless { cloud, region } OR pod { environment, pod_type, pods, replicas, shards }).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          dimension: { type: 'integer', minimum: 1 },
          metric: { type: 'string', enum: ['cosine', 'euclidean', 'dotproduct'] },
          spec: { type: 'object' },
          deletion_protection: { type: 'string', enum: ['enabled', 'disabled'] },
          tags: { type: 'object' },
          vector_type: { type: 'string', enum: ['dense', 'sparse'] },
        },
        required: ['name', 'dimension', 'metric', 'spec'],
      },
      request: { method: 'POST', path: '/indexes', body: 'args' },
      // Pinecone rejects duplicate index names with 409 ALREADY_EXISTS — the
      // server already enforces name-as-key, so retrying the same payload is
      // safe and idempotent.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'indexes.configure',
      class: 'mutation',
      description:
        'Reconfigure an existing index — change replicas / pod_type (pod indexes), toggle deletion_protection, replace tags. Body matches the PATCH /indexes/{indexName} spec.',
      parameters: {
        type: 'object',
        properties: {
          indexName: { type: 'string' },
          spec: { type: 'object' },
          deletion_protection: { type: 'string', enum: ['enabled', 'disabled'] },
          tags: { type: 'object' },
        },
        required: ['indexName'],
      },
      request: {
        method: 'PATCH',
        path: '/indexes/{indexName}',
        body: {
          spec: '{spec}',
          deletion_protection: '{deletion_protection}',
          tags: '{tags}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'indexes.delete',
      class: 'mutation',
      description: 'Delete an index. Fails if deletion_protection is enabled — caller must indexes.configure first.',
      parameters: {
        type: 'object',
        properties: { indexName: { type: 'string' } },
        required: ['indexName'],
      },
      request: { method: 'DELETE', path: '/indexes/{indexName}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },

    // ─── Control plane: collections (pod-based indexes only) ──────────
    {
      name: 'collections.list',
      class: 'read',
      description: 'List frozen-snapshot collections in the project (pod indexes only).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/collections' },
    },
    {
      name: 'collections.describe',
      class: 'read',
      description: 'Fetch collection metadata (size, vector_count, status, environment).',
      parameters: {
        type: 'object',
        properties: { collectionName: { type: 'string' } },
        required: ['collectionName'],
      },
      request: { method: 'GET', path: '/collections/{collectionName}' },
    },
    {
      name: 'collections.create',
      class: 'mutation',
      description: 'Create a collection (snapshot) from an existing pod index.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          source: { type: 'string', description: 'Name of the source index.' },
        },
        required: ['name', 'source'],
      },
      request: { method: 'POST', path: '/collections', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'collections.delete',
      class: 'mutation',
      description: 'Delete a collection.',
      parameters: {
        type: 'object',
        properties: { collectionName: { type: 'string' } },
        required: ['collectionName'],
      },
      request: { method: 'DELETE', path: '/collections/{collectionName}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },

    // ─── Data plane: vectors ──────────────────────────────────────────
    // Every capability below requires metadata.indexHost to be set on the
    // DataSource — otherwise the request lands on api.pinecone.io and the
    // control plane returns 404.
    {
      name: 'vectors.upsert',
      class: 'mutation',
      description:
        'Upsert vectors into a namespace. Each vector carries { id, values (dense), sparse_values?, metadata? }. Replays with the same ids overwrite — Pinecone keys on (namespace, id).',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          vectors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                values: { type: 'array', items: { type: 'number' } },
                sparse_values: { type: 'object' },
                metadata: { type: 'object' },
              },
              required: ['id'],
            },
          },
        },
        required: ['vectors'],
      },
      request: {
        method: 'POST',
        path: '/vectors/upsert',
        body: { vectors: '{vectors}', namespace: '{namespace}' },
      },
      // Pinecone upsert is keyed by (namespace, id); replays of the same
      // payload converge to the same state.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'vectors.query',
      class: 'read',
      description:
        'Nearest-neighbour query against a namespace. Provide either { vector } (dense), { sparse_vector } (sparse), or { id } (server fetches the vector by id and queries with it). Returns top_k matches with optional metadata + values.',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          top_k: { type: 'integer', minimum: 1, maximum: 10000 },
          filter: { type: 'object' },
          include_values: { type: 'boolean' },
          include_metadata: { type: 'boolean' },
          vector: { type: 'array', items: { type: 'number' } },
          sparse_vector: { type: 'object' },
          id: { type: 'string' },
        },
        required: ['top_k'],
      },
      request: { method: 'POST', path: '/query', body: 'args' },
    },
    {
      name: 'vectors.fetch',
      class: 'read',
      description: 'Fetch vectors by id from a namespace. Returns the dense values + metadata for each found id.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          namespace: { type: 'string' },
        },
        required: ['ids'],
      },
      request: {
        method: 'GET',
        path: '/vectors/fetch',
        // Pinecone wants ids as repeated `ids=` params; the declarative-rest
        // query renderer encodes arrays by joining with commas, which Pinecone
        // accepts because the SDKs all do the same.
        query: { ids: '{ids}', namespace: '{namespace}' },
      },
    },
    {
      name: 'vectors.update',
      class: 'mutation',
      description: 'Partial in-place update of a single vector — replace values, sparse_values, or metadata for an existing id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          values: { type: 'array', items: { type: 'number' } },
          sparse_values: { type: 'object' },
          set_metadata: { type: 'object' },
          namespace: { type: 'string' },
        },
        required: ['id'],
      },
      request: { method: 'POST', path: '/vectors/update', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'vectors.delete',
      class: 'mutation',
      description:
        'Delete vectors. Either pass `ids` (specific vector ids), `filter` (metadata filter — Starter pods do not support this), or `delete_all: true` to wipe the whole namespace.',
      parameters: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          namespace: { type: 'string' },
          delete_all: { type: 'boolean' },
          filter: { type: 'object' },
        },
      },
      request: { method: 'POST', path: '/vectors/delete', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'vectors.list',
      class: 'read',
      description:
        'List vector ids in a namespace (serverless indexes only). Supports prefix filtering and cursor pagination via pagination_token.',
      parameters: {
        type: 'object',
        properties: {
          namespace: { type: 'string' },
          prefix: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          pagination_token: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/vectors/list',
        query: {
          namespace: '{namespace}',
          prefix: '{prefix}',
          limit: '{limit}',
          paginationToken: '{pagination_token}',
        },
      },
    },
    {
      name: 'vectors.describe_index_stats',
      class: 'read',
      description: 'Per-namespace vector counts + total dimension count + index fullness. Useful for capacity dashboards.',
      parameters: {
        type: 'object',
        properties: { filter: { type: 'object' } },
      },
      request: { method: 'POST', path: '/describe_index_stats', body: 'args' },
    },

    // ─── Assistants (Pinecone Assistant API) ──────────────────────────
    // These run against api.pinecone.io control plane — no indexHost required.
    {
      name: 'assistants.list',
      class: 'read',
      description: 'List Pinecone Assistants in the project.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/assistant/assistants' },
    },
    {
      name: 'assistants.describe',
      class: 'read',
      description: 'Fetch metadata for an assistant by name.',
      parameters: {
        type: 'object',
        properties: { assistantName: { type: 'string' } },
        required: ['assistantName'],
      },
      request: { method: 'GET', path: '/assistant/assistants/{assistantName}' },
    },
    {
      name: 'assistants.create',
      class: 'mutation',
      description: 'Create a Pinecone Assistant. Body: { name, instructions?, metadata?, region? }.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          instructions: { type: 'string' },
          metadata: { type: 'object' },
          region: { type: 'string' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/assistant/assistants', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'assistants.delete',
      class: 'mutation',
      description: 'Delete an assistant and its uploaded files.',
      parameters: {
        type: 'object',
        properties: { assistantName: { type: 'string' } },
        required: ['assistantName'],
      },
      request: { method: 'DELETE', path: '/assistant/assistants/{assistantName}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'assistants.chat',
      class: 'mutation',
      description:
        'Send a chat turn to an assistant. Body: { messages: [{ role, content }], model?, stream?, filter?, json_response?, include_highlights? }. Non-idempotent — replay yields a new completion.',
      parameters: {
        type: 'object',
        properties: {
          assistantName: { type: 'string' },
          messages: { type: 'array', items: { type: 'object' } },
          model: { type: 'string' },
          stream: { type: 'boolean' },
          filter: { type: 'object' },
          json_response: { type: 'boolean' },
          include_highlights: { type: 'boolean' },
        },
        required: ['assistantName', 'messages'],
      },
      request: {
        method: 'POST',
        path: '/assistant/chat/{assistantName}',
        body: {
          messages: '{messages}',
          model: '{model}',
          stream: '{stream}',
          filter: '{filter}',
          json_response: '{json_response}',
          include_highlights: '{include_highlights}',
        },
      },
      // Generation is non-idempotent — Pinecone does not honour an
      // idempotency key on chat. Caller owns dedupe.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'assistants.update',
      class: 'mutation',
      description:
        'Update an existing Pinecone Assistant. Pass any subset of { instructions, metadata } — fields omitted from the body are left unchanged.',
      parameters: {
        type: 'object',
        properties: {
          assistantName: { type: 'string' },
          instructions: { type: 'string' },
          metadata: { type: 'object' },
        },
        required: ['assistantName'],
      },
      request: {
        method: 'PATCH',
        path: '/assistant/assistants/{assistantName}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'assistants.files.delete',
      class: 'mutation',
      description:
        'Delete a file previously uploaded to a Pinecone Assistant. The file is removed from the assistant\'s knowledge base; existing chat sessions are unaffected.',
      parameters: {
        type: 'object',
        properties: {
          assistantName: { type: 'string' },
          assistantFileId: { type: 'string', description: 'Assistant file ID returned by the upload endpoint.' },
        },
        required: ['assistantName', 'assistantFileId'],
      },
      request: {
        method: 'DELETE',
        path: '/assistant/files/{assistantName}/{assistantFileId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'backups.create',
      class: 'mutation',
      description:
        'Create a backup snapshot of an index. The backup is project-scoped and can be restored later via the Pinecone control plane.',
      parameters: {
        type: 'object',
        properties: {
          indexName: { type: 'string' },
          name: { type: 'string', description: 'Backup name (project-unique).' },
          description: { type: 'string' },
        },
        required: ['indexName', 'name'],
      },
      request: {
        method: 'POST',
        path: '/indexes/{indexName}/backups',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
