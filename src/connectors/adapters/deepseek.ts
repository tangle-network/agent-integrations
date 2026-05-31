import { declarativeRestConnector } from './declarative-rest.js'

export const deepseekConnector = declarativeRestConnector({
  kind: 'deepseek',
  displayName: 'DeepSeek',
  description: 'Generate completions with DeepSeek chat models via the DeepSeek API.',
  auth: { kind: 'api-key', hint: 'DeepSeek API key (Bearer token from platform.deepseek.com).' },
  category: 'other',
  defaultConsistencyModel: 'cache',
  baseUrl: 'https://api.deepseek.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'Content-Type': 'application/json' },
  test: { method: 'GET', path: '/v1/models' },
  capabilities: [
    {
      name: 'ask.deepseek',
      class: 'mutation',
      description:
        'Run a DeepSeek chat completion. Mirrors the activepieces "Ask Deepseek" action and accepts the same generation knobs.',
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'The DeepSeek model that will generate the completion (e.g. deepseek-chat, deepseek-reasoner).',
          },
          prompt: {
            type: 'string',
            description: 'The user question to send to the model.',
          },
          frequencyPenalty: {
            type: 'number',
            description:
              'Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far.',
          },
          maxTokens: {
            type: 'integer',
            description: 'Maximum number of tokens to generate. Between 1 and 8192.',
          },
          presencePenalty: {
            type: 'number',
            description:
              'Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far.',
          },
          responseFormat: {
            type: 'string',
            description: 'Response format: "text" or "json_object". JSON mode requires the prompt to also instruct JSON output.',
            enum: ['text', 'json_object'],
          },
          temperature: {
            type: 'number',
            description: 'Sampling temperature between 0 and 2. Lower values produce more deterministic output.',
          },
          topP: {
            type: 'number',
            description:
              'Nucleus sampling cutoff. Values <= 1. Generally alter this OR temperature, not both.',
          },
          memoryKey: {
            type: 'string',
            description:
              'Optional key that shares chat history across runs. Leave empty to invoke the model statelessly.',
          },
          roles: {
            type: 'array',
            description:
              'Optional array of role messages prepended to the conversation (e.g. system / assistant / user turns).',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
        },
        required: ['model', 'prompt', 'maxTokens', 'responseFormat'],
      },
      request: {
        method: 'POST',
        path: '/v1/chat/completions',
        body: {
          model: '{model}',
          messages: [{ role: 'user', content: '{prompt}' }],
          frequency_penalty: '{frequencyPenalty}',
          max_tokens: '{maxTokens}',
          presence_penalty: '{presencePenalty}',
          response_format: { type: '{responseFormat}' },
          temperature: '{temperature}',
          top_p: '{topP}',
        },
      },
      cas: 'none',
      externalEffect: false,
    },
    {
      name: 'models.list',
      class: 'read',
      description: 'List the chat models the DeepSeek account can invoke.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/v1/models' },
    },
  ],
})
