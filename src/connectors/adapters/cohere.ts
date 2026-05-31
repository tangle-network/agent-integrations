import { declarativeRestConnector } from './declarative-rest.js'

export const cohereConnector = declarativeRestConnector({
  kind: 'cohere',
  displayName: 'Cohere',
  description: 'Generate text using Cohere AI language models.',
  auth: { kind: 'api-key', hint: 'Cohere API key (Bearer token).' },
  category: 'other',
  defaultConsistencyModel: 'cache',
  baseUrl: 'https://api.cohere.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'Content-Type': 'application/json' },
  test: { method: 'GET', path: '/v1/models' },
  capabilities: [
    {
      name: 'generate.text',
      class: 'mutation',
      description:
        'Generate text from a prompt using a Cohere chat model. Mirrors the activepieces "Generate Text" action.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The user message to send to the model.',
          },
          model: {
            type: 'string',
            description: 'The Cohere model to use for generation (e.g., command-r-plus, command-r).',
          },
          temperature: {
            type: 'number',
            description: 'Controls randomness (0.0 = deterministic, 1.0 = maximum randomness).',
          },
          maxTokens: {
            type: 'integer',
            description: 'Maximum number of tokens to generate.',
          },
        },
        required: ['prompt', 'model'],
      },
      request: {
        method: 'POST',
        path: '/v2/chat',
        body: {
          model: '{model}',
          messages: [{ role: 'user', content: '{prompt}' }],
          temperature: '{temperature}',
          max_tokens: '{maxTokens}',
        },
      },
      cas: 'none',
      externalEffect: false,
    },
  ],
})
