import { declarativeRestConnector } from './declarative-rest.js'

/**
 * CometAPI connector.
 *
 * CometAPI is a unified inference gateway that fronts multiple model
 * providers (OpenAI, Anthropic, Google, Meta, Mistral, …) behind a single
 * OpenAI-compatible REST surface. A single bearer API key authenticates every
 * call; routing to a specific underlying provider is done by the `model`
 * field on the request body — there is no per-provider endpoint.
 *
 * The activepieces catalog ships a single high-level action (`ask.comet.api`)
 * which is a thin wrapper over the chat-completions endpoint. We expose that
 * as the primary `chat.completions.create` capability and add the rest of the
 * OpenAI-compatible surface CometAPI documents (models list, embeddings,
 * images) so the agent has a real tool kit, not just one knob.
 *
 * Consistency model: `advisory`. Every mutation here is a stateless
 * generation call — replaying it yields a different sample, never the same
 * record, so authoritative semantics would be a lie. The caller's
 * MutationGuard owns at-most-once delivery via an idempotency token if it
 * cares.
 */
export const cometapiConnector = declarativeRestConnector({
  kind: 'cometapi',
  displayName: 'CometAPI',
  description:
    'Access multiple AI models (GPT, Claude, Gemini, Llama, Mistral, …) through CometAPI’s unified OpenAI-compatible inference gateway.',
  auth: {
    kind: 'api-key',
    hint: 'CometAPI key (sent as Authorization: Bearer …). Create one at https://www.cometapi.com/.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.cometapi.com',
  credentialPlacement: { kind: 'bearer' },
  // GET /v1/models is the canonical low-cost authenticated probe on
  // OpenAI-compatible gateways.
  test: { method: 'GET', path: '/v1/models' },
  capabilities: [
    {
      name: 'models.list',
      class: 'read',
      description: 'List every model id CometAPI will route to.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/models' },
    },
    {
      name: 'models.get',
      class: 'read',
      description: 'Fetch metadata for a single routed model id.',
      parameters: {
        type: 'object',
        properties: { model: { type: 'string', description: 'Model id, e.g. gpt-4o, claude-sonnet-4-5, gemini-2.5-pro.' } },
        required: ['model'],
      },
      request: { method: 'GET', path: '/v1/models/{model}' },
    },
    {
      name: 'chat.completions.create',
      class: 'mutation',
      description:
        'Ask CometAPI — the catalog’s primary action. Generate a chat completion against any routed model by setting `model` on the body. OpenAI-compatible request schema.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'Routed model id (gpt-4o, claude-sonnet-4-5, gemini-2.5-pro, llama-3.3-70b, …).',
          },
          messages: {
            type: 'array',
            description: 'Ordered chat turns; each item is { role, content }.',
            items: { type: 'object' },
          },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          top_p: { type: 'number', minimum: 0, maximum: 1 },
          max_tokens: { type: 'integer', minimum: 1 },
          stop: {},
          stream: { type: 'boolean' },
          n: { type: 'integer', minimum: 1 },
          presence_penalty: { type: 'number', minimum: -2, maximum: 2 },
          frequency_penalty: { type: 'number', minimum: -2, maximum: 2 },
          tools: { type: 'array', items: { type: 'object' } },
          tool_choice: {},
          response_format: { type: 'object' },
          user: { type: 'string' },
        },
        required: ['model', 'messages'],
      },
      request: { method: 'POST', path: '/v1/chat/completions', body: 'args' },
      // Generation is non-idempotent at the model layer; CometAPI does not
      // honour an idempotency key. Replay yields a fresh sample.
      cas: 'none',
    },
    {
      name: 'completions.create',
      class: 'mutation',
      description: 'Legacy text-completion endpoint kept for models that still expose it.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          prompt: {},
          temperature: { type: 'number', minimum: 0, maximum: 2 },
          top_p: { type: 'number', minimum: 0, maximum: 1 },
          max_tokens: { type: 'integer', minimum: 1 },
          stop: {},
          stream: { type: 'boolean' },
          n: { type: 'integer', minimum: 1 },
        },
        required: ['model', 'prompt'],
      },
      request: { method: 'POST', path: '/v1/completions', body: 'args' },
      cas: 'none',
    },
    {
      name: 'embeddings.create',
      class: 'mutation',
      description: 'Generate an embedding vector for one or more input strings.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Embedding model id (e.g. text-embedding-3-large).' },
          input: { description: 'String or array of strings to embed.' },
          encoding_format: { type: 'string', enum: ['float', 'base64'] },
          dimensions: { type: 'integer', minimum: 1 },
          user: { type: 'string' },
        },
        required: ['model', 'input'],
      },
      request: { method: 'POST', path: '/v1/embeddings', body: 'args' },
      // Embeddings are deterministic given (model, input) but CometAPI does
      // not advertise a server-side idempotency contract, so we still treat
      // this as caller-owned dedupe rather than lying about native semantics.
      cas: 'none',
    },
    {
      name: 'images.generate',
      class: 'mutation',
      description: 'Generate an image from a text prompt via a routed image model.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          prompt: { type: 'string' },
          n: { type: 'integer', minimum: 1 },
          size: { type: 'string' },
          quality: { type: 'string' },
          response_format: { type: 'string', enum: ['url', 'b64_json'] },
          user: { type: 'string' },
        },
        required: ['prompt'],
      },
      request: { method: 'POST', path: '/v1/images/generations', body: 'args' },
      cas: 'none',
    },
  ],
})
