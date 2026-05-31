/**
 * @stable Avian connector — OpenAI-compatible chat completions on api.avian.io.
 *
 * Avian exposes an OpenAI-compatible inference surface for hosted language
 * models. The activepieces piece-avian publishes a single `askAvian` action;
 * underneath it is a `POST /v1/chat/completions` call with the standard
 * OpenAI request shape (model, messages, temperature, top_p, frequency_penalty,
 * presence_penalty, max_tokens, response_format).
 *
 * API base : https://api.avian.io
 * Auth     : `Authorization: Bearer <api-key>` (api-key credential).
 * Docs     : https://docs.avian.io
 *
 * Consistency model is `authoritative`: Avian is the system of record for
 * the completions it returns — adapters do not cache or replay them.
 */

import { declarativeRestConnector } from './declarative-rest.js'

const chatMessage = {
  type: 'object',
  properties: {
    role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
    content: { type: 'string' },
    name: { type: 'string' },
    tool_call_id: { type: 'string' },
  },
  required: ['role', 'content'],
}

export const avianConnector = declarativeRestConnector({
  kind: 'avian',
  displayName: 'Avian',
  description:
    'Run chat completions against Avian-hosted language models via the OpenAI-compatible /v1/chat/completions surface.',
  auth: {
    kind: 'api-key',
    hint: 'Avian API key (see your Avian account dashboard). Sent as `Authorization: Bearer <key>`.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.avian.io',
  credentialPlacement: { kind: 'bearer' },
  test: { method: 'GET', path: '/v1/models' },
  capabilities: [
    {
      name: 'ask.avian',
      class: 'mutation',
      description:
        'Generate a completion from an Avian-hosted model. Mirrors the OpenAI chat-completions request shape.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'Avian model id (e.g. an Avian-hosted Llama or Mixtral variant).',
          },
          messages: {
            type: 'array',
            items: chatMessage,
            description:
              'Chat history as an array of role/content messages. If absent, `prompt` is wrapped into a single user message.',
          },
          prompt: {
            type: 'string',
            description:
              'Convenience single-turn prompt; combined with `roles` into a `messages` array at request time.',
          },
          roles: {
            type: 'array',
            items: chatMessage,
            description: 'Optional system/assistant priming messages prepended to `prompt`.',
          },
          temperature: {
            type: 'number',
            description:
              'Sampling temperature (0–2). Lower is more deterministic. Recommend altering this OR top_p but not both.',
          },
          topP: {
            type: 'number',
            description:
              'Nucleus-sampling cutoff (0–1). Considers tokens covering top_p of the probability mass.',
          },
          maxTokens: {
            type: 'integer',
            description: 'Hard upper bound on tokens generated for this completion.',
          },
          frequencyPenalty: {
            type: 'number',
            description: 'Frequency-penalty (-2.0 to 2.0). Discourages literal token repetition.',
          },
          presencePenalty: {
            type: 'number',
            description: 'Presence-penalty (-2.0 to 2.0). Encourages topic variety.',
          },
          responseFormat: {
            type: 'string',
            enum: ['text', 'json_object'],
            description:
              'Constrain the output format. When `json_object`, the prompt MUST also instruct the model to emit JSON.',
          },
          memoryKey: {
            type: 'string',
            description:
              'Shared-history key — when set, Avian threads the conversation across runs that reuse the same key.',
          },
          stream: {
            type: 'boolean',
            description: 'Stream tokens as server-sent events instead of returning a single response.',
          },
        },
        required: ['model'],
      },
      request: {
        method: 'POST',
        path: '/v1/chat/completions',
        body: {
          model: '{model}',
          messages: '{messages}',
          temperature: '{temperature}',
          top_p: '{topP}',
          max_tokens: '{maxTokens}',
          frequency_penalty: '{frequencyPenalty}',
          presence_penalty: '{presencePenalty}',
          response_format: '{responseFormat}',
          stream: '{stream}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'models.list',
      class: 'read',
      description: 'List Avian-hosted models available to the current API key.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/v1/models' },
    },
  ],
})
