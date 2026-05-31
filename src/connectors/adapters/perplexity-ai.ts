import { declarativeRestConnector } from './declarative-rest.js'

export const perplexityAiConnector = declarativeRestConnector({
  kind: 'perplexity-ai',
  displayName: 'Perplexity AI',
  description: 'Create chat completions using Perplexity AI models.',
  auth: { kind: 'api-key', hint: 'Perplexity AI API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.perplexity.ai',
  test: { method: 'GET', path: '/models' },
  capabilities: [
    {
      name: 'chat.create-completion',
      class: 'mutation',
      description: 'Create a chat completion using Perplexity AI.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'The model to use (e.g., pplx-7b-online, pplx-70b-online, pplx-8x7b-online).' },
          messages: { type: 'array', description: 'Array of message objects with role and content.' },
          temperature: { type: 'number', description: 'Controls randomness (0-2). Higher values increase randomness.' },
          top_p: { type: 'number', description: 'Nucleus sampling threshold (0-1). Affects diversity of responses.' },
          top_k: { type: 'integer', description: 'Limits token selection to top k most likely tokens.' },
          max_tokens: { type: 'integer', description: 'Maximum number of tokens to generate.' },
          frequency_penalty: { type: 'number', description: 'Penalizes frequent tokens (-2 to 2).' },
          presence_penalty: { type: 'number', description: 'Penalizes tokens already in the prompt (-2 to 2).' },
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
          top_k: '{top_k}',
          max_tokens: '{max_tokens}',
          frequency_penalty: '{frequency_penalty}',
          presence_penalty: '{presence_penalty}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
