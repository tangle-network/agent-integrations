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
  ],
})
