import { declarativeRestConnector } from './declarative-rest.js'

// LocalAI is a self-hosted OpenAI-compatible inference server. Each
// installation runs on its own host, so the connection stores the instance
// URL in the `base_url` metadata field (declared as required + non-secret
// in the activepieces auth manifest). The optional access token, when
// present, is sent as a Bearer credential — LocalAI accepts the same
// Authorization header shape as the upstream OpenAI API.
//
// The activepieces piece exposes a single "Ask Local AI" action that issues
// a chat-completion request and a model-listing call backs the model
// dropdown — both are mirrored here so generated agents can both enumerate
// models and run a completion against a chosen one.
export const localaiConnector = declarativeRestConnector({
  kind: 'localai',
  displayName: 'LocalAI',
  description:
    'Call a self-hosted LocalAI instance over its OpenAI-compatible REST surface: list available models and run chat completions.',
  auth: {
    kind: 'api-key',
    hint: 'Optional LocalAI access token. The connection must also store the instance base URL (e.g. https://localai.example.com) in the base_url metadata field.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'base_url' },
  test: { method: 'GET', path: '/v1/models' },
  capabilities: [
    {
      name: 'models.list',
      class: 'read',
      description: 'List models served by the LocalAI instance.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/v1/models' },
    },
    {
      name: 'ask.local.ai',
      class: 'mutation',
      description:
        'Run a chat completion against the LocalAI instance. Mirrors the activepieces askLocalAI action: a single prompt with sampling controls and optional role/system messages.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description:
              'Model id from /v1/models. LocalAI serves whatever model files are installed on the host; there is no fixed enum.',
          },
          prompt: {
            type: 'string',
            description: 'User prompt forwarded as the final user-role message.',
          },
          roles: {
            type: 'array',
            description:
              'Optional preceding messages (system / assistant / prior user turns). When omitted only the prompt is sent.',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          temperature: {
            type: 'number',
            description:
              'Sampling temperature. Lower values make the model more deterministic.',
          },
          maxTokens: {
            type: 'integer',
            description:
              'Maximum number of tokens to generate across prompt + completion.',
            minimum: 1,
          },
          topP: {
            type: 'number',
            description:
              'Nucleus-sampling cutoff. 0.1 keeps only the top 10% probability mass.',
          },
          frequencyPenalty: {
            type: 'number',
            description:
              'Frequency penalty in [-2, 2]. Positive values discourage token repetition by frequency.',
            minimum: -2,
            maximum: 2,
          },
          presencePenalty: {
            type: 'number',
            description:
              'Presence penalty in [-2, 2]. Positive values encourage new topics.',
            minimum: -2,
            maximum: 2,
          },
        },
        required: ['model', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/v1/chat/completions',
        body: {
          model: '{model}',
          messages: '{roles}',
          temperature: '{temperature}',
          max_tokens: '{maxTokens}',
          top_p: '{topP}',
          frequency_penalty: '{frequencyPenalty}',
          presence_penalty: '{presencePenalty}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
