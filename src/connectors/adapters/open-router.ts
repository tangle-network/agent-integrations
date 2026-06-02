import { declarativeRestConnector } from './declarative-rest.js'

export const openRouterConnector = declarativeRestConnector({
  kind: 'open-router',
  displayName: 'OpenRouter',
  description: 'Use any AI model to generate code, text, or images via OpenRouter.ai.',
  auth: {
    kind: 'api-key',
    hint: 'OpenRouter API key.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://openrouter.ai/api/v1',
  test: { method: 'GET', path: '/auth/key' },
  capabilities: [
    {
      name: 'models.list',
      class: 'read',
      description: 'List available models on OpenRouter.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/models' },
    },
    {
      name: 'completions.create',
      class: 'mutation',
      description: 'Generate a completion using a specified model.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'The model to use for generation.',
          },
          messages: {
            type: 'array',
            description: 'Array of message objects with role and content.',
          },
          temperature: {
            type: 'number',
            description: 'Controls randomness; lower values are more deterministic.',
          },
          top_p: {
            type: 'number',
            description: 'Nucleus sampling parameter.',
          },
          max_tokens: {
            type: 'integer',
            description: 'Maximum tokens to generate.',
          },
        },
        required: ['model', 'messages'],
      },
      request: {
        method: 'POST',
        path: '/chat/completions',
        body: {
          model: '{model}',
          messages: '{messages}',
          temperature: '{temperature}',
          top_p: '{top_p}',
          max_tokens: '{max_tokens}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'credits.get',
      class: 'read',
      description: 'Get the current account credit balance and total usage.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/credits' },
    },
    {
      name: 'keys.list',
      class: 'read',
      description: 'List provisioning API keys on the account.',
      parameters: {
        type: 'object',
        properties: {
          offset: { type: 'integer', description: 'Pagination offset.' },
          include_disabled: { type: 'boolean', description: 'Include revoked/disabled keys.' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/keys',
        query: { offset: '{offset}', include_disabled: '{include_disabled}' },
      },
    },
    {
      name: 'keys.create',
      class: 'mutation',
      description: 'Create a new provisioning API key on the account.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable name for the key.' },
          label: { type: 'string', description: 'Optional label for the key.' },
          limit: { type: 'number', description: 'Optional credit limit in USD.' },
        },
        required: ['name'],
      },
      // Optional `label`/`limit` are forwarded via `body: 'args'` so the
      // renderer doesn't throw on unset placeholders.
      request: { method: 'POST', path: '/keys', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'keys.revoke',
      class: 'mutation',
      description: 'Revoke an existing provisioning API key by its hash.',
      parameters: {
        type: 'object',
        properties: {
          hash: { type: 'string', description: 'Hash identifier of the key to revoke.' },
        },
        required: ['hash'],
      },
      request: { method: 'DELETE', path: '/keys/{hash}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
