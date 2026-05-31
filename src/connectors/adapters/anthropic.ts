import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Anthropic Messages API connector.
 *
 * Authentication: workspace API key delivered in the `x-api-key` header (no
 * OAuth surface — Anthropic does not expose a 3-legged flow). Every request
 * must also carry an `anthropic-version` header; pinning at construction time
 * gives the connector a stable contract that survives the vendor rolling new
 * versions.
 *
 * Endpoint surface covered: messages, streaming-equivalent (caller must opt
 * in via `stream: true` in the body), token counting, message batches, models
 * listing, and the files API metadata operations. Multipart file UPLOAD is
 * intentionally not declared here — the declarative-rest engine JSON-encodes
 * bodies, which would corrupt the multipart boundary; that goes through a
 * bespoke adapter when needed.
 */
const ANTHROPIC_VERSION = '2023-06-01'

export const anthropicConnector = declarativeRestConnector({
  kind: 'anthropic',
  displayName: 'Anthropic',
  description:
    'Generate completions with Claude models, run batch jobs, count tokens, and inspect uploaded files via the Anthropic Messages API.',
  auth: {
    kind: 'api-key',
    hint: 'Anthropic workspace API key (starts with sk-ant-…). Create one at https://console.anthropic.com/settings/keys.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.anthropic.com',
  credentialPlacement: { kind: 'header', header: 'x-api-key' },
  defaultHeaders: {
    'anthropic-version': ANTHROPIC_VERSION,
  },
  // GET /v1/models is the canonical low-cost authenticated probe.
  test: { method: 'GET', path: '/v1/models' },
  capabilities: [
    {
      name: 'messages.create',
      class: 'mutation',
      description:
        'Create a single message completion against a Claude model. Pass the full Messages-API body (model, max_tokens, messages, optional system, tools, stream).',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'Anthropic model id, e.g. claude-opus-4-5-20251101 or claude-sonnet-4-5.',
          },
          max_tokens: { type: 'integer', minimum: 1 },
          messages: {
            type: 'array',
            description: 'Ordered conversation turns (role + content array).',
            items: { type: 'object' },
          },
          system: {
            description: 'Optional system prompt — string or content-block array.',
          },
          temperature: { type: 'number', minimum: 0, maximum: 1 },
          top_p: { type: 'number', minimum: 0, maximum: 1 },
          top_k: { type: 'integer', minimum: 0 },
          stop_sequences: { type: 'array', items: { type: 'string' } },
          stream: { type: 'boolean' },
          tools: { type: 'array', items: { type: 'object' } },
          tool_choice: { type: 'object' },
          metadata: { type: 'object' },
          thinking: { type: 'object' },
        },
        required: ['model', 'max_tokens', 'messages'],
      },
      request: {
        method: 'POST',
        path: '/v1/messages',
        body: 'args',
      },
      // Generation is non-idempotent at the model layer; replay yields a new
      // sample. Anthropic does not honour an idempotency key on /v1/messages,
      // so the only honest CAS posture is `none` — the caller owns dedupe.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'messages.count_tokens',
      class: 'read',
      description:
        'Return the input token count Anthropic would charge for a given message body, without running generation.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          messages: { type: 'array', items: { type: 'object' } },
          system: {},
          tools: { type: 'array', items: { type: 'object' } },
          tool_choice: { type: 'object' },
        },
        required: ['model', 'messages'],
      },
      request: {
        method: 'POST',
        path: '/v1/messages/count_tokens',
        body: 'args',
      },
    },
    {
      name: 'models.list',
      class: 'read',
      description: 'List Claude models available to the calling workspace.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          after_id: { type: 'string' },
          before_id: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/models',
        query: {
          limit: '{limit}',
          after_id: '{after_id}',
          before_id: '{before_id}',
        },
      },
    },
    {
      name: 'models.get',
      class: 'read',
      description: 'Fetch metadata for a specific Claude model (display name, max output tokens, deprecation date).',
      parameters: {
        type: 'object',
        properties: { model_id: { type: 'string' } },
        required: ['model_id'],
      },
      request: { method: 'GET', path: '/v1/models/{model_id}' },
    },
    {
      name: 'batches.create',
      class: 'mutation',
      description:
        'Submit a Message Batches job: an array of request objects each carrying its own custom_id and Messages-API params. Returns a batch handle the caller polls.',
      parameters: {
        type: 'object',
        properties: {
          requests: {
            type: 'array',
            description: 'Up to 100k requests; each item is { custom_id, params } where params matches /v1/messages.',
            items: { type: 'object' },
          },
        },
        required: ['requests'],
      },
      request: {
        method: 'POST',
        path: '/v1/messages/batches',
        body: { requests: '{requests}' },
      },
      // Anthropic does not dedupe batch submissions; replay creates a new
      // batch. Caller-owned dedupe only.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'batches.list',
      class: 'read',
      description: 'List recent message batches.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          after_id: { type: 'string' },
          before_id: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/messages/batches',
        query: {
          limit: '{limit}',
          after_id: '{after_id}',
          before_id: '{before_id}',
        },
      },
    },
    {
      name: 'batches.get',
      class: 'read',
      description: 'Retrieve the status of a previously-submitted message batch (in_progress, canceling, ended).',
      parameters: {
        type: 'object',
        properties: { batch_id: { type: 'string' } },
        required: ['batch_id'],
      },
      request: { method: 'GET', path: '/v1/messages/batches/{batch_id}' },
    },
    {
      name: 'batches.results',
      class: 'read',
      description:
        'Stream the JSONL results of an ended batch. The connector returns the raw response body — the caller is responsible for line-splitting.',
      parameters: {
        type: 'object',
        properties: { batch_id: { type: 'string' } },
        required: ['batch_id'],
      },
      request: { method: 'GET', path: '/v1/messages/batches/{batch_id}/results' },
    },
    {
      name: 'batches.cancel',
      class: 'mutation',
      description: 'Request cancellation of an in-progress batch. In-flight requests may still complete.',
      parameters: {
        type: 'object',
        properties: { batch_id: { type: 'string' } },
        required: ['batch_id'],
      },
      request: { method: 'POST', path: '/v1/messages/batches/{batch_id}/cancel', body: {} },
      // Idempotent on the server: re-cancelling a cancelled batch is a no-op
      // and returns the same terminal state.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'batches.delete',
      class: 'mutation',
      description: 'Delete a batch (only allowed once the batch has ended).',
      parameters: {
        type: 'object',
        properties: { batch_id: { type: 'string' } },
        required: ['batch_id'],
      },
      request: { method: 'DELETE', path: '/v1/messages/batches/{batch_id}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'files.list',
      class: 'read',
      description:
        'List files previously uploaded for use with the Files API (file IDs referenced by document content blocks). Requires the files beta header at the server level.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          after_id: { type: 'string' },
          before_id: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/files',
        headers: { 'anthropic-beta': 'files-api-2025-04-14' },
        query: {
          limit: '{limit}',
          after_id: '{after_id}',
          before_id: '{before_id}',
        },
      },
    },
    {
      name: 'files.get',
      class: 'read',
      description: 'Fetch metadata for an uploaded file (size, mime type, created_at).',
      parameters: {
        type: 'object',
        properties: { file_id: { type: 'string' } },
        required: ['file_id'],
      },
      request: {
        method: 'GET',
        path: '/v1/files/{file_id}',
        headers: { 'anthropic-beta': 'files-api-2025-04-14' },
      },
    },
    {
      name: 'files.delete',
      class: 'mutation',
      description: 'Delete an uploaded file. File IDs already embedded in saved conversations remain dangling.',
      parameters: {
        type: 'object',
        properties: { file_id: { type: 'string' } },
        required: ['file_id'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/files/{file_id}',
        headers: { 'anthropic-beta': 'files-api-2025-04-14' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
