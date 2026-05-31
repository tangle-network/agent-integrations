import { declarativeRestConnector } from './declarative-rest.js'

export const claudeConnector = declarativeRestConnector({
  kind: 'claude',
  displayName: 'Anthropic Claude',
  description: 'Send messages to Claude AI and extract structured data.',
  auth: { kind: 'api-key', hint: 'Anthropic API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.anthropic.com',
  test: { method: 'GET', path: '/v1/models' },
  capabilities: [
    {
      name: 'ask.claude',
      class: 'read',
      description: 'Send a message to Claude and get a response.',
      parameters: {
        type: 'object',
        properties: {
          model: { type: 'string', default: 'claude-3-5-sonnet-20241022' },
          messages: { type: 'array' },
          max_tokens: { type: 'integer', default: 1024 },
          system: { type: 'string' },
          temperature: { type: 'number', default: 1 },
        },
        required: ['messages'],
      },
      request: {
        method: 'POST',
        path: '/v1/messages',
        body: {
          model: '{model}',
          messages: '{messages}',
          max_tokens: '{max_tokens}',
          system: '{system}',
          temperature: '{temperature}',
        },
      },
    },
    {
      name: 'extract.structured.data',
      class: 'read',
      description: 'Extract structured data from text using Claude.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          schema: { type: 'object' },
          model: { type: 'string', default: 'claude-3-5-sonnet-20241022' },
          max_tokens: { type: 'integer', default: 1024 },
        },
        required: ['text', 'schema'],
      },
      request: {
        method: 'POST',
        path: '/v1/messages',
        body: {
          model: '{model}',
          messages: [
            {
              role: 'user',
              content: 'Extract structured data from the following text according to the provided schema:\n\n{text}',
            },
          ],
          max_tokens: '{max_tokens}',
        },
      },
    },
  ],
})
