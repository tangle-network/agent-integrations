import { declarativeRestConnector } from './declarative-rest.js'

export const detectingAiConnector = declarativeRestConnector({
  kind: 'detecting-ai',
  displayName: 'Detecting.AI',
  description: 'Detect AI-generated content, check plagiarism, and humanize text.',
  auth: { kind: 'api-key', hint: 'Detecting.AI API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.detecting.ai/v1',
  test: { method: 'GET', path: '/check' },
  capabilities: [
    {
      name: 'content.detect-ai',
      class: 'read',
      description: 'Detect if content is AI-generated.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' }, version: { type: 'string' }, model: { type: 'string' } },
        required: ['text', 'version', 'model'],
      },
      request: { method: 'POST', path: '/detect-content', body: { text: '{text}', version: '{version}', model: '{model}' } },
    },
    {
      name: 'plagiarism.check',
      class: 'read',
      description: 'Check text for plagiarism.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' }, version: { type: 'string' }, model: { type: 'string' } },
        required: ['text', 'version', 'model'],
      },
      request: { method: 'POST', path: '/check-plagiarism', body: { text: '{text}', version: '{version}', model: '{model}' } },
    },
    {
      name: 'text.humanize',
      class: 'mutation',
      description: 'Humanize AI-generated text.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' }, version: { type: 'string' }, model: { type: 'string' } },
        required: ['text', 'version', 'model'],
      },
      request: { method: 'POST', path: '/humanize-text', body: { text: '{text}', version: '{version}', model: '{model}' } },
      cas: 'native-idempotency',
    },
  ],
})
