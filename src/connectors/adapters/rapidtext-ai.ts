import { declarativeRestConnector } from './declarative-rest.js'

export const rapidtextAiConnector = declarativeRestConnector({
  kind: 'rapidtext-ai',
  displayName: 'RapidText AI',
  description: 'Generate articles and send prompts using RapidText AI.',
  auth: { kind: 'api-key', hint: 'RapidText AI API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.rapidtext.ai/v1',
  test: { method: 'GET', path: '/status' },
  capabilities: [
    {
      name: 'article.generate',
      class: 'mutation',
      description: 'Generate an article using RapidText AI.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The prompt for article generation.' },
          max_tokens: { type: 'integer', description: 'Maximum number of tokens to generate.' },
          temperature: { type: 'number', description: 'Sampling temperature between 0 and 2.' },
          top_p: { type: 'number', description: 'Nucleus sampling parameter.' },
          frequency_penalty: { type: 'number', description: 'Penalty for new tokens based on frequency.' },
          presence_penalty: { type: 'number', description: 'Penalty for new tokens based on presence.' },
        },
        required: ['prompt'],
      },
      request: {
        method: 'POST',
        path: '/article/generate',
        body: {
          prompt: '{prompt}',
          max_tokens: '{max_tokens}',
          temperature: '{temperature}',
          top_p: '{top_p}',
          frequency_penalty: '{frequency_penalty}',
          presence_penalty: '{presence_penalty}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'prompt.send',
      class: 'mutation',
      description: 'Send a prompt to RapidText AI for processing.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The text prompt to process.' },
          max_tokens: { type: 'integer', description: 'Maximum number of tokens to generate.' },
          temperature: { type: 'number', description: 'Sampling temperature between 0 and 2.' },
          top_p: { type: 'number', description: 'Nucleus sampling parameter.' },
          frequency_penalty: { type: 'number', description: 'Penalty for new tokens based on frequency.' },
          presence_penalty: { type: 'number', description: 'Penalty for new tokens based on presence.' },
        },
        required: ['prompt'],
      },
      request: {
        method: 'POST',
        path: '/prompt/send',
        body: {
          prompt: '{prompt}',
          max_tokens: '{max_tokens}',
          temperature: '{temperature}',
          top_p: '{top_p}',
          frequency_penalty: '{frequency_penalty}',
          presence_penalty: '{presence_penalty}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
